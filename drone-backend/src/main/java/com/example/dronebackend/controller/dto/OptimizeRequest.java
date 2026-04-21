package com.example.dronebackend.controller.dto;

import jakarta.validation.constraints.NotNull;

public record OptimizeRequest(
        @NotNull Double targetLat,
        @NotNull Double targetLon
) {
}

