package com.example.dronebackend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.ArrayList;
import java.util.List;

@Configuration
public class CorsConfig {

    @Value("${qswarm.cors.extra-origins:}")
    private String extraOriginPatterns;

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                List<String> patterns = new ArrayList<>();
                patterns.add("http://localhost:*");
                patterns.add("http://127.0.0.1:*");
                // Capacitor / hybrid WebView origins (see https://capacitorjs.com/docs/config)
                patterns.add("https://localhost");
                patterns.add("capacitor://localhost");
                patterns.add("ionic://localhost");

                if (extraOriginPatterns != null && !extraOriginPatterns.isBlank()) {
                    for (String part : extraOriginPatterns.split(",")) {
                        String p = part.trim();
                        if (!p.isEmpty()) {
                            patterns.add(p);
                        }
                    }
                }

                registry.addMapping("/**")
                        .allowedOriginPatterns(patterns.toArray(new String[0]))
                        .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                        .allowedHeaders("*")
                        .allowCredentials(true);
            }
        };
    }
}
