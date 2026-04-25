package com.example.dronebackend.service;

import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class QuantumOptimizerService {

    private static final Pattern SELECTED_PATTERN = Pattern.compile("^Selected:\\s*(HAWK-\\d{2})\\s*$", Pattern.MULTILINE);

    public record OptimizationResult(String selectedDroneName, String rawOutput) {
    }

    public OptimizationResult runOptimizer(double targetLat, double targetLon) throws IOException, InterruptedException {
        File workingDir = new File(System.getProperty("user.dir"));
        File script = resolveOptimizerScript(workingDir)
                .orElseThrow(() -> new IOException(
                        "Python optimizer script not found. Set QSWARM_OPTIMIZER_SCRIPT or place quantum_optimizer.py "
                                + "next to the JAR or in the repo root (../quantum_optimizer.py from drone-backend)."));

        File processDir = script.getParentFile() != null ? script.getParentFile() : workingDir;

        List<String> cmd = new ArrayList<>();
        cmd.add(pythonExecutable());
        cmd.add(script.getAbsolutePath());
        cmd.add("--target-lat");
        cmd.add(Double.toString(targetLat));
        cmd.add("--target-lon");
        cmd.add(Double.toString(targetLon));
        cmd.add("--p");
        cmd.add("1");
        cmd.add("--shots");
        cmd.add("2048");

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(processDir);
        pb.redirectErrorStream(true);

        Process proc = pb.start();

        boolean finished = proc.waitFor(Duration.ofSeconds(60).toMillis(), TimeUnit.MILLISECONDS);
        if (!finished) {
            proc.destroyForcibly();
            throw new IOException("Python optimizer timed out.");
        }

        String output;
        try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append('\n');
            }
            output = sb.toString();
        }

        if (proc.exitValue() != 0) {
            throw new IOException("Python optimizer failed (exit=" + proc.exitValue() + "). Output:\n" + output);
        }

        Optional<String> selected = parseSelectedDrone(output);
        if (selected.isEmpty()) {
            throw new IOException("Could not parse selected drone from optimizer output. Output:\n" + output);
        }

        return new OptimizationResult(selected.get(), output);
    }

    private static Optional<String> parseSelectedDrone(String stdout) {
        Matcher m = SELECTED_PATTERN.matcher(stdout);
        if (!m.find()) {
            return Optional.empty();
        }
        return Optional.ofNullable(m.group(1));
    }

    private static String pythonExecutable() {
        // Prefer python3 if available; fall back to python (common on Windows/venv setups).
        // This is intentionally simple; users can control it via PATH.
        return "python3";
    }

    /**
     * Resolves {@code quantum_optimizer.py} for local dev, Docker (/app), or custom paths via {@code QSWARM_OPTIMIZER_SCRIPT}.
     */
    private static Optional<File> resolveOptimizerScript(File workingDir) throws IOException {
        String env = System.getenv("QSWARM_OPTIMIZER_SCRIPT");
        if (env != null && !env.isBlank()) {
            File f = new File(env.trim());
            if (f.isFile()) {
                return Optional.of(f.getCanonicalFile());
            }
        }

        File sameDir = new File(workingDir, "quantum_optimizer.py").getCanonicalFile();
        if (sameDir.isFile()) {
            return Optional.of(sameDir);
        }

        File repoRoot = new File(workingDir, "../quantum_optimizer.py").getCanonicalFile();
        if (repoRoot.isFile()) {
            return Optional.of(repoRoot);
        }

        return Optional.empty();
    }
}

