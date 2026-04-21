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

        // Expected layout:
        //   <repo>/quantum_optimizer.py
        //   <repo>/drone-backend/   (this app)
        //
        // When running `mvn spring-boot:run` in drone-backend, user.dir is <repo>/drone-backend.
        File script = new File(workingDir, "../quantum_optimizer.py").getCanonicalFile();
        if (!script.exists()) {
            throw new IOException("Python optimizer script not found at: " + script);
        }

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
        pb.directory(workingDir);
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
}

