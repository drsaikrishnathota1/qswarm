package com.example.dronebackend.service;

import com.example.dronebackend.model.Drone;
import com.example.dronebackend.model.DroneStatus;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class DroneService {
    private final List<Drone> drones = List.of(
            new Drone("1", "HAWK-01", DroneStatus.ACTIVE, 86, 32.8021, -96.7892, 120.5),
            new Drone("2", "HAWK-02", DroneStatus.STANDBY, 74, 32.7767, -96.7970, 95.2),
            new Drone("3", "HAWK-03", DroneStatus.ACTIVE, 62, 32.7420, -96.8560, 140.0),
            new Drone("4", "HAWK-04", DroneStatus.STANDBY, 91, 32.8590, -96.7350, 110.0),
            new Drone("5", "HAWK-05", DroneStatus.ACTIVE, 53, 32.7150, -96.6850, 130.0)
    );

    public List<Drone> listDrones() {
        return drones;
    }
}

