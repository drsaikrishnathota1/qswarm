package com.example.dronebackend.model;

public record Drone(
        String id,
        String name,
        DroneStatus status,
        int batteryPercentage,
        double latitude,
        double longitude,
        double altitude
) {
}

