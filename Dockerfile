# Build and run the Spring Boot API with Python + Qiskit for /api/drones/optimize.
# Build from repository root:
#   docker build -t qswarm-api .
# Run:
#   docker run --rm -p 8080:8080 qswarm-api

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY drone-backend/pom.xml drone-backend/
COPY drone-backend/src drone-backend/src
RUN cd drone-backend && mvn -B -q package -DskipTests

FROM eclipse-temurin:17-jre-jammy
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/drone-backend/target/*.jar /app/app.jar
COPY quantum_optimizer.py /app/quantum_optimizer.py
RUN python3 -m venv /opt/qswarm-venv \
    && /opt/qswarm-venv/bin/pip install --no-cache-dir qiskit qiskit-aer
ENV PATH="/opt/qswarm-venv/bin:${PATH}"
ENV QSWARM_OPTIMIZER_SCRIPT=/app/quantum_optimizer.py
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
