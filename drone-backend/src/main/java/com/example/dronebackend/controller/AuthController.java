package com.example.dronebackend.controller;

import com.example.dronebackend.controller.dto.LoginRequest;
import com.example.dronebackend.controller.dto.LoginResponse;
import com.example.dronebackend.security.FakeJwt;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest req) {
        if (!"operator1".equals(req.username()) || !"password123".equals(req.password())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(new LoginResponse(FakeJwt.TOKEN));
    }
}

