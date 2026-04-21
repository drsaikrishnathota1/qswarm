package com.example.dronebackend.controller;

import com.example.dronebackend.controller.dto.OptimizeRequest;
import com.example.dronebackend.controller.dto.OptimizeResponse;
import com.example.dronebackend.model.Drone;
import com.example.dronebackend.service.DroneService;
import com.example.dronebackend.service.QuantumOptimizerService;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api/drones")
public class DroneController {

    private final DroneService droneService;
    private final QuantumOptimizerService optimizerService;

    public DroneController(DroneService droneService, QuantumOptimizerService optimizerService) {
        this.droneService = droneService;
        this.optimizerService = optimizerService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<Drone> listDrones() {
        return droneService.listDrones();
    }

    @PostMapping(value = "/optimize", produces = MediaType.APPLICATION_JSON_VALUE)
    public OptimizeResponse optimize(@Valid @RequestBody OptimizeRequest req) throws IOException, InterruptedException {
        QuantumOptimizerService.OptimizationResult result =
                optimizerService.runOptimizer(req.targetLat(), req.targetLon());

        return new OptimizeResponse(
                result.selectedDroneName(),
                "Selected by local QAOA run in ../quantum_optimizer.py (parsed from stdout).",
                result.rawOutput()
        );
    }
}

