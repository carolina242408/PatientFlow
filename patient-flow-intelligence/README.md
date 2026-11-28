# Patient Flow Intelligence

```
frontend/     React + Vite + TypeScript + Tailwind (porta 5173)
backend/      Spring Boot, Java 21, Maven (porta 8080)
algorithms/   FastAPI, Python (porta 8000, corre no compose)
keycloak/     realm "patientflow" e tema de login custom
postgres-init/ SQL de criação das bases de dados
docker-compose.yml  infraestrutura de desenvolvimento
```

## Como correr

Para desenvolver o backend no host: Docker, JDK 21+ e `JAVA_HOME` configurado.

```bash
cp .env.example .env               # credenciais de desenvolvimento
docker compose up -d postgresql keycloak algorithms
cd backend
./mvnw spring-boot:run              # http://localhost:8080; perfil normal sem seed
```

No PowerShell usar `./mvnw.cmd`. O realm de desenvolvimento é importado de
`keycloak/realm`; gerir as contas/papéis no Keycloak. Um realm já existente
não é sobrescrito pela importação no arranque. Um gestor precisa do papel
Keycloak e de um grupo organizacional compatível no claim `groups` do JWT.
A atribuição faz-se no Keycloak e exige renovar o token;
`/api/access/grants` mantém apenas registos legados, sem efeito na autorização.
Ver [SECURITY.md](backend/SECURITY.md).

Criar ULS, unidade ou serviço pela API exige credenciais de administração
Keycloak no backend. O Compose de desenvolvimento injeta-as a partir de `.env`;
ao executar no host, exportar `KEYCLOAK_ADMIN_USERNAME` e
`KEYCLOAK_ADMIN_PASSWORD` antes do arranque, conforme
[backend/README.md](backend/README.md#executar).

Para executar também o frontend e o backend em contentores, na pasta
`patient-flow-intelligence`:

```sh
docker compose up -d --build
```

Usar este modo ou o backend no host, pois ambos usam a porta 8080.

O algorithms usa CPU por defeito. Para usar uma GPU NVIDIA, acrescentar
`COMPOSE_FILE` ao `.env`, uma vez por máquina, e reconstruir com `--build`.
Ver [algorithms/README.md](algorithms/README.md#cpu-ou-gpu-em-docker), que
descreve também o risco de tempo de arranque em CPU.

| Serviço | URL |
|---|---|
| Frontend (integração parcial) | http://localhost:5173 |
| Backend API | http://localhost:8080/api |
| Keycloak admin | https://localhost:9080 (admin/admin) |
| algorithms | http://localhost:8000/health |
| HAPI FHIR | http://localhost:8081 |
| RabbitMQ UI | http://localhost:15672 (pfi/pfi) |

Credenciais de desenvolvimento em `.env` (criado a partir de `.env.example`, não vai para o git).

## Keycloak HTTPS configuration

To use HTTPS in Keycloak, you need a certificate. For development, you can generate a self-signed one with Subject Alternative Names (`DNS:localhost,DNS:keycloak`):

### Linux / macOS / Git Bash
```bash
cd patient-flow-intelligence
mkdir -p certs
cd certs
openssl req -x509 -out localhostCertificate.pem -keyout localhostKey.pem -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' -extensions EXT -config <(printf "[dn]\nCN=localhost\n[req]\ndistinguished_name = dn\n[EXT]\nsubjectAltName=DNS:localhost,DNS:keycloak\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth")
cd ..
```

### Windows (PowerShell)
No PowerShell (onde a sintaxe `<(...)` não é suportada), pode gerar-se através do Python:
```powershell
cd patient-flow-intelligence
python -c "import os, datetime, ipaddress; from cryptography import x509; from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID; from cryptography.hazmat.primitives import hashes, serialization; from cryptography.hazmat.primitives.asymmetric import rsa; os.makedirs('certs', exist_ok=True); k = rsa.generate_private_key(65537, 2048); s = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')]); c = x509.CertificateBuilder().subject_name(s).issuer_name(s).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(datetime.datetime.now(datetime.timezone.utc)).not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=825)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.DNSName('keycloak'), x509.IPAddress(ipaddress.IPv4Address('127.0.0.1'))]), critical=False).add_extension(x509.KeyUsage(True, False, True, False, False, False, False, False, False), critical=False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False).sign(k, hashes.SHA256()); open('certs/localhostKey.pem', 'wb').write(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption())); open('certs/localhostCertificate.pem', 'wb').write(c.public_bytes(serialization.Encoding.PEM)); print('Certificados criados com sucesso em certs/!')"
```
O fluxo atual usa diretamente PostgreSQL, Keycloak e algorithms. RabbitMQ, Redis
e HAPI FHIR existem no Compose alargado, mas não constituem integrações ativas
do fluxo atual. A definição MinIO está comentada e a consola não é iniciada.
O backend expõe indicadores, decisões determinísticas `rules-v1` e eventos
WebSocket. O frontend já consulta hierarquia, camas, ocupantes e episódios;
o dashboard mantém dados fixos e ainda não consome as APIs analíticas nem os
eventos WebSocket. Modelos treinados são trabalho futuro.

A hierarquia atual é ULS → unidade → edifício → piso → serviço → ala →
enfermaria → quarto → cama. A migração V2 foi alterada; não está garantida a
atualização de bases que tenham aplicado a hierarquia anterior. Os testes Java
foram removidos nesta fase; os exemplos FHIR para verificação manual estão no
[README do backend](backend/README.md#exemplos-autónomos).

Contratos: [API/FHIR](backend/README.md), [gestão operacional](backend/OPERATIONS.md),
[permissões/eventos](backend/SECURITY.md), [indicadores/algoritmos](backend/ANALYTICS.md).
Trabalho futuro sobre modelos inteligentes: [PLAN.md](backend/PLAN.md).
