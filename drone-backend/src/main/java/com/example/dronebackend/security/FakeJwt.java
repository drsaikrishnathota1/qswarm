package com.example.dronebackend.security;

public final class FakeJwt {
    private FakeJwt() {
    }

    // This is intentionally fake (no signing/claims). The auth filter simply matches this exact string.
    public static final String TOKEN = "fake-jwt-token";
}

