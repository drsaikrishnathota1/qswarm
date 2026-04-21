package com.example.dronebackend.controller.dto;

public record OptimizeResponse(
        String selectedDroneName,
        String selectionReason,
        String rawOutput
) {
}

