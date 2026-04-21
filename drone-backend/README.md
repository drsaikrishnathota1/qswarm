## drone-backend

Spring Boot 3 backend (port **8080**) with:

- **POST** `/api/auth/login` → returns a fake JWT token (`fake-jwt-token`)
- **GET** `/api/drones` → requires `Authorization: Bearer fake-jwt-token`
- **POST** `/api/drones/optimize` → runs `../quantum_optimizer.py` via `ProcessBuilder` and returns the selected drone

### Run

From `drone-backend/`:

```bash
mvn spring-boot:run
```

### Example usage

Login:

```bash
curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{ "username": "operator1", "password": "password123" }'
```

List drones (requires token):

```bash
curl -s http://localhost:8080/api/drones \
  -H 'Authorization: Bearer fake-jwt-token'
```

Optimize:

```bash
curl -s -X POST http://localhost:8080/api/drones/optimize \
  -H 'Authorization: Bearer fake-jwt-token' \
  -H 'Content-Type: application/json' \
  -d '{ "targetLat": 32.8, "targetLon": -96.7 }'
```

