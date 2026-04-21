#!/usr/bin/env python3
"""
Local QAOA demo: pick the best military drone for a mission using Qiskit + Qiskit Aer.

Dependencies (install in a venv): pip install qiskit qiskit-aer
Run: python quantum_optimizer.py --target-lat 32.78 --target-lon -96.80

Note: Qiskit depends on NumPy; this script uses NumPy for small classical numerics, but it
does not require extra *quantum* packages beyond `qiskit` and `qiskit-aer` (no cloud SDKs).

macOS / OpenMP: Qiskit Aer ships with LLVM OpenMP (`libomp`). If another library (SciPy,
Accelerate, etc.) already initialized a different OpenMP runtime, Aer can abort with
`__kmp_register_library_startup` / `omp_get_max_threads`. The environment variables below are
set *before* importing NumPy/Qiskit to reduce that risk; Aer is also forced onto a single
thread for execution.
"""

from __future__ import annotations

import os

# --- OpenMP / BLAS thread caps (must run before importing NumPy, Qiskit, or Qiskit Aer) -----
# Aer + SciPy can each link OpenMP; this is the usual workaround for duplicate-runtime aborts.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("QISKIT_PARALLEL", "FALSE")
# Intel OpenMP can try to use shared-memory files; disabling can help in some containers.
os.environ.setdefault("KMP_USE_SHM", "0")

import argparse
import math
import random
import sys
from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.circuit import ParameterVector
from qiskit.circuit.library import PauliEvolutionGate
from qiskit.quantum_info import Pauli, SparsePauliOp, Statevector
from qiskit.primitives import StatevectorEstimator
from qiskit_aer import AerSimulator


# --- Classical helpers (stdlib + NumPy) ---------------------------------------


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points."""
    r_earth_km = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return r_earth_km * c


@dataclass(frozen=True)
class Drone:
    name: str
    battery_pct: float
    lat: float
    lon: float


def random_dallas_position(rng: random.Random) -> tuple[float, float]:
    """Rough bounding box around Dallas, TX (for a lightweight simulation)."""
    lat = rng.uniform(32.60, 33.10)
    lon = rng.uniform(-97.20, -96.50)
    return lat, lon


def simulate_fleet(rng: random.Random) -> list[Drone]:
    drones: list[Drone] = []
    for i in range(1, 6):
        lat, lon = random_dallas_position(rng)
        drones.append(
            Drone(
                name=f"HAWK-{i:02d}",
                battery_pct=float(rng.uniform(50.0, 100.0)),
                lat=lat,
                lon=lon,
            )
        )
    return drones


def weighted_mission_cost_km(
    drones: Iterable[Drone], target_lat: float, target_lon: float
) -> list[float]:
    """
    Lower is better. Combines proximity to the target with battery headroom.

    Distance is in km; battery term penalizes low charge on a comparable scale.
    """
    costs: list[float] = []
    dists = [haversine_km(d.lat, d.lon, target_lat, target_lon) for d in drones]
    d_max = max(dists) if dists else 1.0
    for d, dist_km in zip(drones, dists, strict=True):
        dist_term = dist_km / max(d_max, 1e-6)
        battery_term = (100.0 - d.battery_pct) / 50.0  # 0 at 100%, 1 at 50%
        costs.append(0.65 * dist_term + 0.35 * battery_term)
    return costs


# --- Quantum problem encoding -------------------------------------------------


def build_diagonal_scores(num_qubits: int, drone_scores: list[float], invalid_penalty: float) -> list[float]:
    """
    Build a length-2^n diagonal describing a classical energy landscape.

    Qubit j represents whether drone j is selected (|1> = selected). We only
    reward computational basis states that select exactly one drone (one-hot).
    All other bitstrings receive a large negative score so the optimizer avoids them.
    """
    dim = 1 << num_qubits
    diag: list[float] = [0.0] * dim
    for idx in range(dim):
        bits = [(idx >> j) & 1 for j in range(num_qubits)]
        if sum(bits) != 1:
            diag[idx] = invalid_penalty
            continue
        drone_index = bits.index(1)
        diag[idx] = drone_scores[drone_index]
    return diag


def diagonal_to_sparse_pauli_z(diag: Sequence[float]) -> SparsePauliOp:
    """
    Map a diagonal Hamiltonian (in the Z basis) to a Pauli sum.

    Any diagonal operator on n qubits can be expanded as a linear combination of
    Pauli strings containing only I and Z. QAOA uses this as the *cost* (problem)
    Hamiltonian H_C whose expectation we try to raise with alternating mixer layers.

    Implementation note: we expand using a Walsh–Hadamard style sum over the
    computational basis. This avoids routing through SciPy-based decompositions
    that can be brittle in some restricted runtime environments.
    """
    dim = len(diag)
    n = dim.bit_length() - 1
    if dim != (1 << n):
        raise ValueError("Diagonal length must be a power of two.")

    terms: list[tuple[str, float]] = []
    inv_dim = 1.0 / float(dim)
    for a in range(dim):
        coeff = 0.0
        for x in range(dim):
            parity = (a & x).bit_count() & 1
            coeff += float(diag[x]) * (-1.0 if parity else 1.0)
        coeff *= inv_dim
        if abs(coeff) < 1e-12:
            continue

        # Qiskit Pauli labels are ordered q_{n-1} ... q_0 (left to right).
        label_chars: list[str] = []
        for qi in range(n - 1, -1, -1):
            label_chars.append("Z" if (a >> qi) & 1 else "I")
        terms.append(("".join(label_chars), coeff))

    return SparsePauliOp.from_list(terms)


def sum_pauli_x_mixer(num_qubits: int) -> SparsePauliOp:
    """Standard QAOA mixer: H_M = sum_i X_i (drives amplitude between bitstrings)."""
    terms: list[SparsePauliOp] = []
    for i in range(num_qubits):
        label_chars = ["I"] * num_qubits
        label_chars[i] = "X"
        terms.append(SparsePauliOp(Pauli("".join(label_chars))))
    return sum(terms[1:], terms[0])


def build_qaoa_circuit(cost_hamiltonian: SparsePauliOp, mixer_hamiltonian: SparsePauliOp, reps: int) -> QuantumCircuit:
    """
    Construct a QAOA-style parameterized circuit.

    Quantum idea (high level):
    - Start from the uniform superposition |+>^n so every assignment has amplitude.
    - Apply exp(-i gamma_k H_C) to imprint phases from the problem Hamiltonian.
    - Apply exp(-i beta_k H_M) to mix those phases, spreading amplitude toward
      low-energy / high-score states of H_C when parameters are well chosen.
    - Repeat for k = 1..reps (QAOA depth). Larger reps can improve quality but
      increase optimization and simulation cost.
    """
    n = cost_hamiltonian.num_qubits
    gammas = ParameterVector("γ", reps)
    betas = ParameterVector("β", reps)

    qc = QuantumCircuit(n)
    qc.h(range(n))  # |+>^n initial state

    for layer in range(reps):
        # Problem layer: evolve under the cost Hamiltonian for time gamma[layer]
        qc.append(PauliEvolutionGate(cost_hamiltonian, gammas[layer]), range(n))
        # Mixer layer: evolve under sum X for time beta[layer]
        qc.append(PauliEvolutionGate(mixer_hamiltonian, betas[layer]), range(n))

    return qc


def brute_force_best_score(diag: Sequence[float]) -> tuple[int, float]:
    best_idx = max(range(len(diag)), key=lambda i: float(diag[i]))
    return best_idx, float(diag[best_idx])


def index_to_assignment(idx: int, num_qubits: int) -> str:
    bits = [(idx >> j) & 1 for j in range(num_qubits)]
    return "".join(str(b) for b in reversed(bits))  # MSB..LSB for readability (q4..q0)


def optimize_qaoa_params(
    qc: QuantumCircuit,
    cost_hamiltonian: SparsePauliOp,
    *,
    reps: int,
    grid_points: int = 18,
) -> tuple[np.ndarray, float]:
    """
    Classical outer loop: search gamma/beta grids to maximize <H_C>.

    This is not quantum hardware; it is a small classical search that tunes the
    QAOA angles so the Qiskit StatevectorEstimator reports a high expectation value
    for the same cost Hamiltonian used inside the quantum circuit.
    """
    estimator = StatevectorEstimator()
    best_params: np.ndarray | None = None
    best_ev = -float("inf")

    axis = np.linspace(0.0, 2.0 * math.pi, grid_points, endpoint=False)
    # beta is often taken in [0, pi] for many Ising encodings; keep search compact.
    axis_beta = np.linspace(0.0, math.pi, max(12, grid_points - 4), endpoint=False)

    if reps == 1:
        for g in axis:
            for b in axis_beta:
                params = np.array([g, b], dtype=float)
                job = estimator.run([(qc, [cost_hamiltonian], [params])])
                ev = float(job.result()[0].data.evs[0])
                if ev > best_ev:
                    best_ev = ev
                    best_params = params
    else:
        # Small random search for reps>1 to avoid exponential grid blow-up.
        rng = np.random.default_rng(0)
        for _ in range(900):
            params = np.concatenate(
                [
                    rng.uniform(0.0, 2.0 * math.pi, size=reps),
                    rng.uniform(0.0, math.pi, size=reps),
                ]
            )
            job = estimator.run([(qc, [cost_hamiltonian], [params])])
            ev = float(job.result()[0].data.evs[0])
            if ev > best_ev:
                best_ev = ev
                best_params = params

    if best_params is None:
        raise RuntimeError("Parameter search failed unexpectedly.")
    return best_params, best_ev


def sample_measurement_counts(
    qc: QuantumCircuit,
    params: np.ndarray,
    *,
    shots: int = 8192,
) -> dict[str, int]:
    """
    Execute the parameterized QAOA circuit on Aer with measurements.

    The quantum state is not read out directly; shots return bitstrings sampled
    from the computational basis distribution induced by the final statevector.
    """
    backend = AerSimulator(method="statevector")
    # Keep Aer strictly single-threaded so its bundled OpenMP does not fight with other
    # libraries or initialize parallel regions from worker threads (a known crash source).
    try:
        backend.set_options(
            max_parallel_threads=1,
            max_parallel_experiments=1,
            max_parallel_shots=1,
        )
    except Exception:
        # Option names vary slightly across qiskit-aer versions; best-effort only.
        pass

    measured = qc.copy()
    measured.measure_all()
    bound = measured.assign_parameters(params)
    compiled = transpile(bound, backend=backend, optimization_level=1)
    job = backend.run(compiled, shots=shots)
    return job.result().get_counts()


def best_one_hot_from_counts(
    counts: dict[str, int],
    *,
    num_qubits: int,
    drone_scores: list[float],
) -> tuple[str, int] | None:
    """
    Pick the most frequent *valid* one-hot measurement outcome.

    Invalid strings (all-zero, multi-drone, etc.) can dominate raw counts for
    shallow QAOA; those are not feasible mission plans, so they are ignored here.
    Ties in shot counts are broken by the higher classical score for that drone.
    """
    best: tuple[str, int, float] | None = None  # (bitstring, shots, tiebreak_score)
    for bitstring, c in counts.items():
        idx = one_hot_index_from_msb_bitstring(bitstring, num_qubits)
        if idx is None:
            continue
        score = float(drone_scores[idx])
        candidate = (bitstring, int(c), score)
        if best is None:
            best = candidate
            continue
        if candidate[1] > best[1] or (candidate[1] == best[1] and candidate[2] > best[2]):
            best = candidate
    if best is None:
        return None
    return best[0], best[1]


def one_hot_index_from_msb_bitstring(s: str, num_qubits: int) -> int | None:
    """
    Convert Aer/Qiskit-style MSB-first bitstring (e.g., '00100') to a drone index.

    We placed drone j on qubit j with little-endian indexing in the diagonal, so
    we interpret the rightmost character as qubit 0.
    """
    if len(s) != num_qubits:
        return None
    bits_lsb_first = [int(ch) for ch in reversed(s)]
    if sum(bits_lsb_first) != 1:
        return None
    return bits_lsb_first.index(1)


def best_one_hot_from_statevector_probs(
    probs: np.ndarray,
    *,
    num_qubits: int,
    drone_scores: list[float],
) -> tuple[str, int, float]:
    """
    Fallback selection: choose the one-hot basis state with largest Born probability.

    Returns (MSB..LSB bitstring, basis_index, probability).
    """
    best_idx = 0
    best_p = -1.0
    best_score = -float("inf")
    for i, p in enumerate(probs):
        bits = [(i >> j) & 1 for j in range(num_qubits)]
        if sum(bits) != 1:
            continue
        drone_index = bits.index(1)
        score = float(drone_scores[drone_index])
        p = float(p)
        if p > best_p or (math.isclose(p, best_p) and score > best_score):
            best_p = p
            best_idx = i
            best_score = score
    return index_to_assignment(best_idx, num_qubits), best_idx, best_p


def probability_on_one_hot_states(probs: np.ndarray, *, num_qubits: int) -> float:
    mass = 0.0
    for i, p in enumerate(probs):
        bits = [(i >> j) & 1 for j in range(num_qubits)]
        if sum(bits) == 1:
            mass += float(p)
    return mass


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Local QAOA drone assignment demo (Qiskit + Aer).")
    p.add_argument("--target-lat", type=float, default=None, help="Mission latitude (deg).")
    p.add_argument("--target-lon", type=float, default=None, help="Mission longitude (deg).")
    p.add_argument("--seed", type=int, default=None, help="RNG seed for reproducible drone generation.")
    p.add_argument("--p", type=int, default=1, choices=(1, 2), help="QAOA depth (number of alternating layers).")
    p.add_argument("--shots", type=int, default=8192, help="Measurement shots on AerSimulator.")
    return p.parse_args(argv)


def prompt_target_if_missing(lat: float | None, lon: float | None) -> tuple[float, float]:
    if lat is not None and lon is not None:
        return lat, lon
    print("Enter mission target GPS (WGS84). Example near Dallas: lat=32.78 lon=-96.80")
    if lat is None:
        lat = float(input("Target latitude: ").strip())
    if lon is None:
        lon = float(input("Target longitude: ").strip())
    return lat, lon


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    rng = random.Random(args.seed)

    target_lat, target_lon = prompt_target_if_missing(args.target_lat, args.target_lon)

    drones = simulate_fleet(rng)
    costs = weighted_mission_cost_km(drones, target_lat, target_lon)

    # Higher score is better for the cost Hamiltonian expectation maximization.
    drone_scores = [10.0 - c for c in costs]
    invalid_penalty = -250.0

    num_qubits = len(drones)
    diag = build_diagonal_scores(num_qubits, drone_scores, invalid_penalty=invalid_penalty)
    cost_hamiltonian = diagonal_to_sparse_pauli_z(diag)
    mixer_hamiltonian = sum_pauli_x_mixer(num_qubits)

    classical_idx, classical_score = brute_force_best_score(diag)
    classical_drone_idx = one_hot_index_from_msb_bitstring(
        index_to_assignment(classical_idx, num_qubits), num_qubits
    )

    qc = build_qaoa_circuit(cost_hamiltonian, mixer_hamiltonian, reps=args.p)
    best_params, best_ev = optimize_qaoa_params(qc, cost_hamiltonian, reps=args.p)

    # Sanity-check the optimized energy against an explicit statevector evaluation.
    sv = Statevector(qc.assign_parameters(best_params))
    ham_mat = cost_hamiltonian.to_matrix()
    check_ev = float(np.real(sv.expectation_value(ham_mat)))
    if not math.isclose(check_ev, best_ev, rel_tol=1e-9, abs_tol=1e-9):
        print(f"Warning: estimator EV ({best_ev}) vs statevector EV ({check_ev}) mismatch.", file=sys.stderr)

    counts = sample_measurement_counts(qc, best_params, shots=args.shots)
    probs = sv.probabilities()
    valid_mass = probability_on_one_hot_states(probs, num_qubits=num_qubits)

    picked = best_one_hot_from_counts(counts, num_qubits=num_qubits, drone_scores=drone_scores)
    selection_mode = "aer_one_hot_counts"
    if picked is None:
        sampled_msb, _basis_idx, _p = best_one_hot_from_statevector_probs(
            probs, num_qubits=num_qubits, drone_scores=drone_scores
        )
        picked_idx = one_hot_index_from_msb_bitstring(sampled_msb, num_qubits)
        selection_mode = "statevector_one_hot_probs_fallback"
    else:
        sampled_msb, _shots = picked
        picked_idx = one_hot_index_from_msb_bitstring(sampled_msb, num_qubits)

    print("\n=== Simulated drone fleet ===")
    for d, c in zip(drones, costs, strict=True):
        dist_km = haversine_km(d.lat, d.lon, target_lat, target_lon)
        print(
            f"- {d.name}: battery={d.battery_pct:5.1f}% | "
            f"pos=({d.lat:7.4f}, {d.lon:8.4f}) | dist_to_target={dist_km:6.2f} km | "
            f"weighted_cost={c:0.4f} (lower is better)"
        )

    print("\n=== Mission target ===")
    print(f"lat={target_lat:.6f}, lon={target_lon:.6f}")

    print("\n=== Quantum part (what the circuit is doing) ===")
    print(
        "- Qubits represent a *decision register*: qubit j corresponds to drone j.\n"
        "- The cost Hamiltonian H_C is diagonal in the computational basis; each one-hot\n"
        "  bitstring |0..010..0> gets a score combining distance + battery pressure.\n"
        "  Invalid selections (0 or 2+ drones) get a strongly negative score (energy penalty).\n"
        "- The mixer H_M = sum X flips individual qubits, exploring assignments while the\n"
        "  problem layers exp(-i γ H_C) imprint phases that interfere constructively for\n"
        "  high-score states when (γ, β) are tuned well.\n"
        "- Qiskit implements exp(-i t H) via PauliEvolutionGate for the Pauli-sum H.\n"
        "- AerSimulator then *samples* measurement outcomes (shots) from the final state."
    )

    print("\n=== QAOA circuit (parameterized; angles filled in after classical search) ===")
    bound_for_print = qc.assign_parameters(best_params)
    print("High-level view (PauliEvolutionGate boxes are the cost/mixer layers):")
    print(bound_for_print.draw(output="text", fold=100))
    decomposed = bound_for_print.decompose(reps=1)
    print("\nSame circuit decomposed one level (shows native 1- and 2-qubit gates):")
    print(decomposed.draw(output="text", fold=120))
    print(f"\nCost Hamiltonian Pauli term count: {len(cost_hamiltonian)} (all Z-type terms from the diagonal encoding).")

    print("\n=== Classical brute-force optimum (over all one-hot states) ===")
    print(
        f"Best basis index={classical_idx} (bitstring MSB..LSB={index_to_assignment(classical_idx, num_qubits)}), "
        f"H_C eigenvalue(score)={classical_score:.4f}"
    )
    if classical_drone_idx is not None:
        cd = drones[classical_drone_idx]
        print(
            f"Classical optimal drone: {cd.name} (weighted_cost={costs[classical_drone_idx]:.4f}, "
            f"distance={haversine_km(cd.lat, cd.lon, target_lat, target_lon):.2f} km)"
        )

    print("\n=== QAOA parameter search (classical loop over angles) ===")
    print(f"Depth p={args.p} | best parameters (γ..., β...) = {np.array2string(best_params, precision=4)}")
    print(
        f"Best estimated <H_C> = {best_ev:.6f} (statevector check {check_ev:.6f}). "
        "Note: H_C assigns a large negative score to invalid assignments, so <H_C> stays "
        "negative until the state concentrates amplitude on feasible one-hot strings."
    )
    print(f"Total probability mass on valid one-hot states (from the final statevector) = {valid_mass:.4f}")

    print("\n=== Aer simulation: measurement statistics ===")
    top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:8]
    print("Top measured bitstrings (MSB..LSB, mapped to q4..q0):")
    for bitstring, c in top:
        pct = 100.0 * c / float(args.shots)
        print(f"- {bitstring}: {c} shots ({pct:5.2f}%)")

    if picked_idx is None:
        print("\nCould not map the sampled outcome to a valid one-hot assignment.")
        return 2

    chosen = drones[picked_idx]
    dist_km = haversine_km(chosen.lat, chosen.lon, target_lat, target_lon)
    print("\n=== Quantum-selected drone (from QAOA + Aer shots) ===")
    print(
        f"Selected: {chosen.name}\n"
        f"Reason: QAOA prepares a state biased toward high-score assignments of H_C; "
        f"after tuning (γ, β) to maximize <H_C>≈{best_ev:.4f}, AerSimulator sampled "
        f"the computational basis {args.shots} times. Selection mode: {selection_mode}. "
        f"The chosen feasible assignment was {sampled_msb}, which selects {chosen.name}. "
        f"This drone has weighted_cost={costs[picked_idx]:.4f} (lower is better), "
        f"battery={chosen.battery_pct:.1f}%, and is {dist_km:.2f} km from the target.\n"
        f"Classical one-hot optimum by score was {drones[classical_drone_idx].name if classical_drone_idx is not None else 'N/A'}."
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
