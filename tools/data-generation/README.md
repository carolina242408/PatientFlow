# PatientFlow Synthetic Data Generator & REST API

Ferramenta de geração de dados sintéticos para o ecossistema **PatientFlow**, desenhada à medida dos sistemas hospitalares portugueses (SClínico, SONHO, ICD-10-CM/PCS, SNS).

Combina o **Synthea** (para percursos clínicos longitudinais realistas com recursos FHIR R4) com um **motor de simulação por eventos discretos** focado na gestão de camas e fluxo de internamento (admissões, transferências e altas), disponibilizado através de um **serviço REST API completo (FastAPI)** na porta `8001` com suporte para consumo direto (*pull*), streaming em tempo real (*SSE*) e subscrições via Webhook (*push*).

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Garantias HL7 v2.5 e Conformidade](#garantias-hl7-v25-e-conformidade)
3. [Eventos Simulados (ADT)](#eventos-simulados-adt)
4. [Estrutura do Hospital e Espaços (`config/hospital.yaml`)](#estrutura-do-hospital-e-espaços-confighospitalyaml)
5. [Como o Backend Spring Boot se Conecta ao Serviço](#como-o-backend-spring-boot-se-conecta-ao-serviço)
   - [5.1 Configuração do Backend (`application.yml`)](#51-configuração-do-backend-applicationyml)
   - [5.2 Ajuste de Segurança Spring Security (`SecurityConfig.java`)](#52-ajuste-de-segurança-spring-security-securityconfigjava)
   - [5.3 Cliente REST no Backend (Java 21 `RestClient`)](#53-cliente-rest-no-backend-java-21-restclient)
   - [5.4 Consumo via Live Streaming SSE (Eventos em Tempo Real)](#54-consumo-via-live-streaming-sse-eventos-em-tempo-real)
   - [5.5 Consumo via Webhook Subscription (Push Automático)](#55-consumo-via-webhook-subscription-push-automático)
   - [5.6 Ingestão de Recursos FHIR R4 (Topologia e Pacientes)](#56-ingestão-de-recursos-fhir-r4-topologia-e-pacientes)
6. [Resumo dos Endpoints da REST API](#resumo-dos-endpoints-da-rest-api)
7. [Instalação e Pré-requisitos](#instalação-e-pré-requisitos)
8. [Visualização em Tempo Real no Terminal (Watch Stream & Live Demo)](#visualização-em-tempo-real-no-terminal-watch-stream--live-demo)
9. [Como Executar](#como-executar)
   - [Fluxo de Desenvolvimento em Simultâneo](#fluxo-de-desenvolvimento-em-simultâneo)
10. [Estrutura de Ficheiros Gerados](#estrutura-de-ficheiros-gerados)
11. [Configurações Editáveis (YAML)](#configurações-editáveis-yaml)
12. [Testes e Validação](#testes-e-validação)

---

## Visão Geral

- **Base Clínica FHIR**: O Synthea gera pacientes com doenças crónicas, episódios prévios, exames laboratoriais, medicação e alergias.
- **Identidade Portuguesa**: A demografia americana do Synthea é substituída por identidades portuguesas realistas (nomes, apelidos com partículas, concelhos do Minho/Braga/Porto com códigos DICOFRE e códigos postais, NIF com algoritmo módulo 11 e nº de utente SNS).
- **Simulação de Fluxo Hospitalar**: Modelo dinâmico com perfil horário de urgência/altas, ocupação alvo por especialidade, macas de corredor em sobrelotação, coorte por sexo nos quartos, transferências intra-serviço, transferências para UCI e step-down, e readmissões a 30 dias.
- **Serviço REST API (FastAPI)**: Servidor HTTP na porta `8001` pronto para ser consumido ou subscrito pelo backend Java Spring Boot (`patient-flow-intelligence/backend`), com documentação Swagger interativa em `http://localhost:8001/docs`.

---

## Garantias HL7 v2.5 e Conformidade

O gerador segue rigorosamente a estrutura dos ficheiros em `tools/hl7-fhir-converter/messages/` e cumpre as seguintes regras estritas:

| Campo HL7 | Descrição | Regra Implementada no Gerador |
|---|---|---|
| **MSH-10** | *Message Control ID* | **Único por mensagem**, gerado via `uuid.uuid4()`. Nunca é reutilizado. |
| **PID-3** | *Patient Identifier List* | Contém os identificadores do paciente: `NS^^^HOS^NS` (Nº Sequencial no hospital) e `SNS^^^HAS^SNS` (Nº Utente SNS). **Garantida a unicidade**: dois pacientes nunca partilham o mesmo NS nem o mesmo SNS. |
| **PID-5** | *Patient Name* | Formatado como `APELIDOS^PRIMEIRO_NOME^OUTROS_NOMES^^^^L`. **Alinhamento estrito com PID-3**: o mesmo NS tem sempre o mesmo nome, sexo e data de nascimento em todas as mensagens. |
| **PID-18.1** | *Patient Account / Processo* | **Nº de Processo Clínico** (`processo^^^HOS`). É estável e persistente para o paciente em todos os episódios de internamento (como no SONHO). |
| **PV1-19** | *Visit Number / Episódio* | **Nº de Episódio de Internamento** (`YYnnnnnn^^^HOS`). Único por internamento. Se o mesmo paciente for readmitido após alta, mantém o PID-3 e PID-18, mas recebe um novo PV1-19. |
| **PID-21** | *Mother's / Tax ID* | **NIF** (`NIF^^^AT^NIF`) com algoritmo de validação módulo 11. |
| **PV1-3** | *Assigned Patient Location* | Ponto de cuidados completo: `Ward^Room^Bed^UID^^Kind^Building^Floor^Label^^Auth` (ex.: `30004^7005^MAC^3147^^Maca^1^7^SALA 5^^HOS` ou `30012^4010^001^3001^^Cama^1^4^SALA 1^^HOS`). |
| **PV1-6** | *Prior Location* | No `A02`, indica exatamente a cama onde o doente se encontrava antes da transferência. No `A01`, indica o serviço de origem (`10015^^^^^URGENCIA` ou `10020^^^^^CONSULTA EXTERNA`). |
| **PV1-10** | *Hospital Service* | Código do serviço responsável (ex.: `30004` Medicina, `30006` Cirurgia, `30020` UCI). Nos casos de *outlier* ("internado em serviço alheio"), o PV1-10 mantém o serviço titular enquanto o PV1-3 aponta para a cama emprestada. |

### Casos de Teste Injetados Intencionalmente
- **Homónimos**: Doentes diferentes com o **mesmo nome** (e até mesma data de nascimento), mas com **NS, SNS, NIF e Nº de Processo obrigatoriamente distintos**, permitindo testar e validar algoritmos de reconciliação de identidade da aplicação.
- **Readmissões a 30 dias**: Doentes que têm alta e voltam a ser admitidos dias mais tarde, mantendo o histórico de identificadores.

---

## Eventos Simulados (ADT)

O simulador emite os seguintes eventos HL7 v2.5:

1. **ADT^A01 (Admissão de Doente com Cama Atribuída)**:
   - Admissões urgentes (vagas da Urgência `10015`) e programadas (cirurgias eletivas / Consulta Externa `10020`).
   - Atribuição de cama em enfermaria com respeito pela coorte de sexo nos quartos.
   - Em caso de sobrelotação temporária da enfermaria: recurso a macas de corredor (`MAC`).
   - Diagnóstico principal em `PV2-3` e `DG1` (código ICD-10 e descrição em maiúsculas).
2. **ADT^A02 (Transferência de Doente)**:
   - **Mudança de cama / quarto**: na mesma enfermaria (`MC` / `MQ`).
   - **Maca para cama**: regularização assim que abre vaga numa cama de quarto (`MCC`).
   - **Transferência para UCI**: agravamento clínico ou pós-operatório (`TU`).
   - **Alta da UCI (Step-down)**: regresso da UCI para a enfermaria do serviço de origem (`AU`).
   - **Transferência entre especialidades**: após avaliação/interconsulta médica (`TS`).
   - **Regresso de outlier**: doente acolhido noutro serviço que regressa à sua enfermaria (`RS`).
3. **ADT^A03 (Alta Hospitalar)**:
   - Destinos realistas em `PV1-36`: Domicílio, Domicílio com apoio, RNCCI (continuados), Lar/ERPI, Transferência para outro hospital ou Óbito.
   - Condição clínica em `PV2-12`: `MELHORADO`, `CURADO`, `INALTERADO`, `AGRAVADO`, `FALECIDO`.
   - Procedimentos realizados em `PR1` (ex.: colecistectomia, artroplastia, apendicectomia).
   - Libertação da cama com período estocástico de higienização antes de ficar disponível.

---

## Estrutura do Hospital e Espaços (`config/hospital.yaml`)

O ficheiro `config/hospital.yaml` modela uma unidade hospitalar portuguesa completa com ~184 camas e macas, perfeitamente sincronizada com a árvore do frontend (`frontend/src/pages/space/data.ts`) e fixtures do conversor:

### Identificadores Institucionais
- **Nome**: `Hospital Sintético do Minho, E.P.E.`
- **Facility (`MSH-4`, `MSH-6`, `EVN-7`)**: `INST`
- **Sending Application (`MSH-3`, autoridade de IDs)**: `HOS`
- **Receiving Application (`MSH-5`)**: `HL7_DEFAULT`
- **Servicing Facility (`PV1-39`)**: `10004`
- **Subsistema de Saúde (`IN1-2`)**: `935601` (`SNS`)
- **Origem Urgente (`PV1-6`)**: `10015` (`URGENCIA`)
- **Origem Programada (`PV1-6`)**: `10020` (`CONSULTA EXTERNA`)

### Enfermarias e Especialidades

| Código | Nome da Enfermaria | Especialidade | Piso | Lotação Normal | Macas de Corredor |
|---|---|---|---|---|---|
| **30004** | Medicina Interna A | `MED` | 7 | 8 quartos x 4 camas = 32 camas | 4 macas (`MAC`) |
| **30005** | Medicina Interna B | `MED` | 6 | 8 quartos x 4 camas = 32 camas | 4 macas (`MAC`) |
| **30006** | Cirurgia Geral | `CIR` | 4 | 6 quartos x 4 camas = 24 camas | 2 macas (`MAC`) |
| **30012** | Ortopedia | `ORT` | 4 | 6 quartos x 4 camas = 24 camas | 2 macas (`MAC`) |
| **30008** | Cardiologia | `CAR` | 5 | 5 quartos x 4 camas = 20 camas | 2 macas (`MAC`) |
| **30009** | Pneumologia | `PNE` | 5 | 5 quartos x 4 camas = 20 camas | 2 macas (`MAC`) |
| **30010** | Neurologia / Unidade AVC | `NEU` | 3 | 5 quartos x 4 camas = 20 camas | 2 macas (`MAC`) |
| **30020** | Medicina Intensiva / UCI | `UCI` | 2 | 12 boxes individuais mistas = 12 camas | 0 macas |

---

## Como o Backend Spring Boot se Conecta ao Serviço

O backend `patient-flow-intelligence/backend` corre em **Java 21 / Spring Boot** na porta `8080`.
O serviço gerador corre na porta `8001`:

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│     PatientFlow Data Gen        │                 │    Patient Flow Intelligence    │
│       (FastAPI / Python)        │                 │      (Spring Boot / Java 21)    │
│      http://localhost:8001      │                 │       http://localhost:8080     │
│                                 │                 │                                 │
│  - POST /api/generate           │ ◄─── PULL ───── │  RestClient / WebClient         │
│  - GET  /api/hl7/messages       │ ◄─── PULL ───── │  Consultas paginadas / filtros  │
│  - GET  /api/hl7/stream         │ ◄─── PULL ───── │  Stream sequencial completo     │
│  - GET  /api/hl7/live (SSE)     │ ──── STREAM ──► │  EventSource / SSE Flux         │
│  - POST /api/subscriptions      │ ◄─── REGISTO ── │  Registo de Webhook             │
│  - POST /api/subscriptions/disp │ ──── PUSH ────► │  POST /api/inbound/hl7-event    │
└─────────────────────────────────┘                 └─────────────────────────────────┘
```

### 5.1 Configuração do Backend (`application.yml`)

No ficheiro `patient-flow-intelligence/backend/src/main/resources/application.yml`, adicione a propriedade do gerador:

```yaml
patientflow:
  data-generator:
    base-url: ${DATA_GENERATOR_URL:http://localhost:8001}
```

---

### 5.2 Ajuste de Segurança Spring Security (`SecurityConfig.java`)

Caso o backend vá receber eventos por **Webhook Push** do gerador em `/api/inbound/**`, configure o `SecurityConfig.java` para permitir essa rota sem exigir Bearer token do Keycloak:

```java
// Em com.projinf.patientflow.security.SecurityConfig:
@Bean
SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    http
        .csrf(csrf -> csrf.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/actuator/health/**").permitAll()
            .requestMatchers("/api/inbound/**").permitAll() // Webhook do gerador de dados
            .anyRequest().authenticated())
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())));
    return http.build();
}
```

---

### 5.3 Cliente REST no Backend (Java 21 `RestClient`)

Com o `RestClient` nativo do Spring Boot (Java 21), crie uma classe de serviço `DataGeneratorClient.java`:

```java
package com.projinf.patientflow.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import java.util.Map;

@Service
public class DataGeneratorClient {

    private final RestClient restClient;

    public DataGeneratorClient(@Value("${patientflow.data-generator.base-url:http://localhost:8001}") String baseUrl) {
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .build();
    }

    /** Dispara a geração de dados com parâmetros personalizados */
    public Map<String, Object> triggerGeneration(int days, int warmupDays, int seed, boolean noSynthea) {
        var payload = Map.of(
            "days", days,
            "warmup_days", warmupDays,
            "seed", seed,
            "no_synthea", noSynthea,
            "validate", true
        );

        return restClient.post()
                .uri("/api/generate")
                .body(payload)
                .retrieve()
                .body(Map.class);
    }

    /** Consulta mensagens HL7 com paginação e filtro por trigger (A01, A02, A03) */
    public Map<String, Object> getHl7Messages(int limit, int offset, String trigger) {
        return restClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/hl7/messages")
                        .queryParam("limit", limit)
                        .queryParam("offset", offset)
                        .queryParamIfPresent("trigger", java.util.Optional.ofNullable(trigger))
                        .build())
                .retrieve()
                .body(Map.class);
    }

    /** Descarrega o stream unificado de todas as mensagens em texto cru */
    public String getRawHl7Stream() {
        return restClient.get()
                .uri("/api/hl7/stream")
                .retrieve()
                .body(String.class);
    }

    /** Descarrega a topologia física completa do hospital (Bundle FHIR) */
    public String getHospitalLocationsBundle() {
        return restClient.get()
                .uri("/api/fhir/hospital-locations")
                .retrieve()
                .body(String.class);
    }

    /** Descarrega o histórico clínico FHIR de um doente pelo seu NS */
    public String getPatientFhirBundle(String ns) {
        return restClient.get()
                .uri("/api/fhir/patients/{ns}", ns)
                .retrieve()
                .body(String.class);
    }
}
```

---

### 5.4 Consumo via Live Streaming SSE (Eventos em Tempo Real)

O endpoint `GET /api/hl7/live` emite eventos Server-Sent Events (`text/event-stream`).

#### Opção A: Consumo em Java puro (Java 21 `HttpClient` - sem dependências adicionais)
```java
package com.projinf.patientflow.web;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.springframework.stereotype.Service;

@Service
public class Hl7LiveStreamConsumer {

    public void startLiveStream(int delayMs) {
        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:8001/api/hl7/live?delay_ms=" + delayMs))
                .header("Accept", "text/event-stream")
                .GET()
                .build();

        client.sendAsync(request, HttpResponse.BodyHandlers.ofLines())
              .thenAccept(response -> response.body().forEach(line -> {
                  if (line.startsWith("data: ")) {
                      String jsonPayload = line.substring(6);
                      // Processar mensagem HL7:
                      // 1. Converter HL7 para entidade / FHIR
                      // 2. Atualizar estado da cama no PatientFlow
                      System.out.println("Evento HL7 recebido: " + jsonPayload);
                  }
              }))
              .exceptionally(ex -> {
                  System.err.println("Erro no SSE stream: " + ex.getMessage());
                  return null;
              });
    }
}
```

#### Opção B: Consumo no Frontend React (`EventSource`)
O frontend React (`frontend/src`) também pode subscrever diretamente:
```typescript
const eventSource = new EventSource("http://localhost:8001/api/hl7/live?delay_ms=250");

eventSource.addEventListener("hl7_a01", (event) => {
  const data = JSON.parse(event.data);
  console.log("Admissão recebida:", data.ns, data.episode);
});

eventSource.addEventListener("hl7_a02", (event) => {
  const data = JSON.parse(event.data);
  console.log("Transferência recebida:", data.ns);
});

eventSource.addEventListener("hl7_a03", (event) => {
  const data = JSON.parse(event.data);
  console.log("Alta recebida:", data.ns);
});
```

---

### 5.5 Consumo via Webhook Subscription (Push Automático)

O backend pode registar o seu URL de callback e receber os eventos por push:

1. **Criar o Controller no Backend Spring Boot (`Hl7InboundController.java`)**:
   ```java
   package com.projinf.patientflow.web;

   import org.springframework.http.ResponseEntity;
   import org.springframework.web.bind.annotation.*;
   import java.util.Map;

   @RestController
   @RequestMapping("/api/inbound")
   public class Hl7InboundController {

       @PostMapping("/hl7-event")
       public ResponseEntity<Void> receiveHl7Event(
               @RequestHeader(value = "X-HL7-Trigger", required = false) String trigger,
               @RequestHeader(value = "X-HL7-Control-Id", required = false) String controlId,
               @RequestHeader(value = "X-HL7-Episode", required = false) String episode,
               @RequestHeader(value = "X-HL7-NS", required = false) String ns,
               @RequestBody Map<String, Object> payload) {

           String rawHl7 = (String) payload.get("hl7");
           System.out.printf("Recebido evento %s para NS %s (Episódio %s)%n", trigger, ns, episode);

           // 1. Chamar o conversor ou serviço de domínio
           // 2. Atualizar ocupação de camas na BD
           return ResponseEntity.ok().build();
       }
   }
   ```

2. **Registar o Webhook via curl ou HTTP**:
   ```bash
   curl -X POST http://localhost:8001/api/subscriptions \
        -H "Content-Type: application/json" \
        -d '{
          "url": "http://localhost:8080/api/inbound/hl7-event",
          "triggers": ["A01", "A02", "A03"],
          "format": "json"
        }'
   ```

3. **Disparar o envio em replay sequencial**:
   ```bash
   curl -X POST http://localhost:8001/api/subscriptions/dispatch \
        -H "Content-Type: application/json" \
        -d '{"delay_ms": 100}'
   ```

---

### 5.6 Ingestão de Recursos FHIR R4 (Topologia e Pacientes)

O gerador expõe bundles FHIR R4 compatíveis com o servidor HAPI FHIR da aplicação (`http://localhost:8081`):

- **Topologia do Hospital**:
  ```bash
  curl http://localhost:8001/api/fhir/hospital-locations
  ```
  Contém `Organization`, `Location` (Enfermaria -> Quarto -> Cama) e `Practitioner`. Pode ser enviado via POST diretamente para o HAPI FHIR:
  ```bash
  curl -X POST http://localhost:8081/fhir \
       -H "Content-Type: application/fhir+json" \
       --data-binary @tools/data-generation/output/fhir/hospital-locations.json
  ```

- **Percurso Clínico do Doente**:
  ```bash
  curl http://localhost:8001/api/fhir/patients/1200001
  ```
  Contém `Patient`, `Condition` (ICD-10 e SNOMED), `Observation`, `Encounter` e `MedicationRequest`.

---

## Resumo dos Endpoints da REST API

| Método | Endpoint | Parâmetros Principais | Descrição |
|---|---|---|---|
| `GET` | `/` | — | Informação do serviço e sitemap de endpoints |
| `GET` | `/health` | — | Estado do serviço e contagem de mensagens em memória |
| `POST` | `/api/generate` | `days`, `warmup_days`, `seed`, `no_synthea`, `validate` | Despoleta execução e simulação |
| `GET` | `/api/simulation/summary` | — | Resumo estatístico da última execução |
| `GET` | `/api/hl7/messages` | `limit`, `offset`, `trigger`, `episode`, `ns`, `since` | Consulta paginada com filtros |
| `GET` | `/api/hl7/messages/{control_id}` | `control_id` (UUIDv4) | Mensagem individual em JSON ou `text/plain` |
| `GET` | `/api/hl7/stream` | — | Stream sequencial unificado de mensagens |
| `GET` | `/api/hl7/live` | `delay_ms`, `trigger` | Live stream Server-Sent Events (SSE) |
| `GET` | `/api/fhir/hospital-locations` | — | Bundle FHIR da hierarquia hospitalar |
| `GET` | `/api/fhir/patients` | — | Lista de números sequenciais (NS) gerados |
| `GET` | `/api/fhir/patients/{ns}` | `ns` | Bundle FHIR R4 longitudinal do paciente |
| `POST` | `/api/subscriptions` | `url`, `triggers`, `format` | Regista webhook de callback |
| `GET` | `/api/subscriptions` | — | Lista subscrições ativas |
| `DELETE` | `/api/subscriptions/{id}` | `id` | Remove subscrição |
| `POST` | `/api/subscriptions/dispatch` | `delay_ms`, `triggers` | Despacha mensagens para os subscritores |

---

## Instalação e Pré-requisitos

1. **Python 3.10+** (ambiente virtual do projeto `venv`):
   ```powershell
   .\venv\Scripts\activate
   pip install -r tools\data-generation\requirements.txt
   ```
2. **Java 11+ / 21+**:
   Necessário para o backend Spring Boot e para o Synthea (o gerador descarrega e coloca em cache automaticamente o `.jar` oficial do Synthea).

---

## Visualização em Tempo Real no Terminal (Watch Stream & Live HL7)

Para ver as mensagens **HL7 v2.5 cruas** a serem geradas e emitidas em tempo real diretamente no terminal:

### 1. Diretamente no Comando Principal (`main.py --print-hl7`)

Use a flag `--print-hl7` (ou `-p`) para imprimir as mensagens HL7 v2.5 pipe a pipe diretamente para a consola:

```powershell
# Geração e impressão em tempo real das mensagens HL7 v2.5:
python tools\data-generation\main.py --no-synthea --days 2 --print-hl7 --delay-ms 100
```

#### Exemplo de Saída no Terminal:
```text
================================================================================
MENSAGENS HL7 v2.5 ADT (63 mensagens geradas)
================================================================================

--- [Mensagem 1/63 | ADT^A01 | MSH-10: b93b21d8-f297-48b4-b838-e1526bdd9dac | Episódio: 26001015] ---
MSH|^~\&|HOS|INST|HL7_DEFAULT|INST|20261001000044||ADT^A01^ADT_A01|b93b21d8-f297-48b4-b838-e1526bdd9dac|D|2.5
EVN|A01|20261001000043||A|7660^CORREIA^PEDRO^^^^^^HOS~13849^CORREIA^PEDRO^^^^^^N.Mecanogr\XE1\fico|20261001000000|INST
PID|1||1201995^^^HOS^NS~128592075^^^HAS^SNS||FERNANDES PEREIRA^SUSANA^DEOLINDA^^^^L||19291205000000|F|||LARGO DA RESTAURA\XC7\\XC3\O, 75^^LAMA\XC7\\XC3\ES^BRAGA^4701-940^PRT^N^BRAGA^030354||^PRN^PH^^^^^^^^^927790104|||CASADA||15002507^^^HOS|||285361538^^^AT^NIF
PV1|1|INT|30012^4010^003^3105^^Cama^1^4^SALA 1^^HOS|U||10015^^^^^URGENCIA|9340^GON\XC7\ALVES^NAT\XC1\LIA^^^^^^HOS~44175^GON\XC7\ALVES^NAT\XC1\LIA^^^^^^N.Ordem~17142^GON\XC7\ALVES^NAT\XC1\LIA^^^^^^N.Mecanogr\XE1\fico|||30012||||1|||9340^GON\XC7\ALVES^NAT\XC1\LIA^^^^^^HOS~44175^GON\XC7\ALVES^NAT\XC1\LIA^^^^^^N.Ordem~17142^GON\XC7\ALVES^NAT\XC1\LIA^^^^^^N.Mecanogr\XE1\fico||26001015^^^HOS||||||||||||||||||||10004||A|||20260930091900|||||||V
PV2|||M17.9^GONARTROSE^ICD10|||||||||
DG1|1||M17.9^GONARTROSE^ICD10^HOS||20260930091900|A|||||||||1||D
IN1|1|935601^SNS^HOS|||||||||||||||||||||||||||||||||||||||||||||||128592075^^^HOS

--- [Mensagem 2/63 | ADT^A01 | MSH-10: c5a52a3e-fcfe-4db1-be76-50124003dbfa | Episódio: 26001020] ---
MSH|^~\&|HOS|INST|HL7_DEFAULT|INST|20261001000111||ADT^A01^ADT_A01|c5a52a3e-fcfe-4db1-be76-50124003dbfa|D|2.5
EVN|A01|20261001000101||A|9112^GON\XC7\ALVES^TERESA^^^^^^HOS~11202^GON\XC7\ALVES^TERESA^^^^^^N.Mecanogr\XE1\fico|20261001000000|INST
PID|1||1202004^^^HOS^NS~260650212^^^HAS^SNS||MARQUES VAZ GUERREIRO^ANT\XD3\NIO^GON\XC7\ALO^^^^L||19510101000000|M|||RUA DO OUTEIRO, 299 1\XBA\ ESQ^^MOREIRA DE C\XD3\NEGOS^BRAGA^4801-486^PRT^N^GUIMAR\XC3\ES^030817||^PRN^PH^^^^^^^^^253993097~^NET^X.400^antonio.guerreiro@outlook.pt|||SOLTEIRO||15002524^^^HOS|||358887941^^^AT^NIF
PV1|1|INT|30006^4023^020^3092^^Cama^1^4^SALA 5^^HOS|C||10020^^^^^CONSULTA EXTERNA|5455^CUNHA^ADELINO^^^^^^HOS~69283^CUNHA^ADELINO^^^^^^N.Ordem~21059^CUNHA^ADELINO^^^^^^N.Mecanogr\XE1\fico|||30006||||2|||5455^CUNHA^ADELINO^^^^^^HOS~69283^CUNHA^ADELINO^^^^^^N.Ordem~21059^CUNHA^ADELINO^^^^^^N.Mecanogr\XE1\fico||26001020^^^HOS||||||||||||||||||||10004||A|||20260930114500|||||||V
PV2|||K56.60^OCLUSAO INTESTINAL^ICD10|||||||||
DG1|1||K56.60^OCLUSAO INTESTINAL^ICD10^HOS||20260930114500|A|||||||||1||D
IN1|1|935601^SNS^HOS|||||||||||||||||||||||||||||||||||||||||||||||260650212^^^HOS
```

---

### 2. Script Dedicado de Streaming em Tempo Real (`watch_stream.py` / `test_stream.py`)

Pode também usar o visualizador contínuo:

```powershell
# Streaming em direto das mensagens HL7 com atraso configurável (ex: 200ms):
python tools\data-generation\watch_stream.py --days 2 --delay-ms 200

# Filtrar apenas admissões (A01), transferências (A02) ou altas (A03):
python tools\data-generation\watch_stream.py --trigger A01 --delay-ms 150

# Ligar ao servidor REST API ativo (recebe o stream em direto via SSE):
python tools\data-generation\watch_stream.py --connect --url http://localhost:8001
```

---

## Como Executar

### Fluxo de Desenvolvimento em Simultâneo

Para ter o ambiente de desenvolvimento completo a correr:

#### Terminal 1: Iniciar o Gerador REST API
```powershell
cd "c:\Users\Diana\OneDrive\Ambiente de Trabalho\MEI\5ano\PI\PatientFlow"
.\venv\Scripts\activate
python tools\data-generation\main.py --serve --port 8001
```

#### Terminal 2: Iniciar a Infraestrutura Docker (Postgres, Keycloak, HAPI FHIR)
```bash
cd patient-flow-intelligence
docker compose up -d
```

#### Terminal 3: Iniciar o Backend Spring Boot
```bash
cd patient-flow-intelligence/backend
./mvnw spring-boot:run
```

#### Terminal 4: Despoletar Simulação de Dados
```bash
# Geração rápida de 7 dias sem Synthea (instantâneo):
curl -X POST http://localhost:8001/api/generate \
     -H "Content-Type: application/json" \
     -d '{"days": 7, "warmup_days": 3, "seed": 42, "no_synthea": true}'

# Ou geração clínica completa com Synthea (14 dias):
curl -X POST http://localhost:8001/api/generate \
     -H "Content-Type: application/json" \
     -d '{"days": 14, "warmup_days": 7, "seed": 42, "no_synthea": false}'
```

---

## Estrutura de Ficheiros Gerados

Após a geração, os dados são também organizados em ficheiros em `tools/data-generation/output/`:

```text
tools/data-generation/output/
|-- stream.hl7                      # Stream unificado de todas as mensagens ordenadas por MSH-7
|-- summary.json                    # Estatísticas detalhadas, taxas de ocupação e relatório de validação
|-- identity-registry.json          # Registo de identificadores atribuídos (garante continuidade em execuções futuras)
|-- hl7/                            # Mensagens HL7 individuais (.hl7)
|   |-- 00001_A01_26000029_7c73009c.hl7
|   |-- 00091_A02_26000068_5cf0837b.hl7
|   |-- 00103_A03_26000018_3847ceb3.hl7
|   `-- ...
`-- fhir/                           # Recursos e Bundles FHIR R4
    |-- hospital-locations.json     # Organization + Locations (Enfermarias, Quartos, Camas) + Practitioners
    `-- patients/                   # Um bundle transaction por paciente ({NS}.json)
        |-- 1200003.json
        |-- 1200059.json
        `-- ...
```

---

## Configurações Editáveis (YAML)

Todos os parâmetros da simulação e da estrutura hospitalar podem ser editados sem alterar código:

- `config/hospital.yaml`:
  - Enfermarias, pisos, especialidades (`MED`, `CIR`, `ORT`, `CAR`, `PNE`, `NEU`, `UCI`).
  - Lotação de quartos, camas por quarto e macas de corredor disponíveis.
  - Códigos de serviço e identificadores da instituição.
- `config/simulation.yaml`:
  - Tempo médio e desvio padrão de internamento (LOS) por especialidade.
  - Perfil horário de admissões e altas ao longo das 24 horas.
  - Taxa de transferências para UCI, altas contra parecer médico, óbitos e readmissões a 30 dias.
  - Taxa de injeção de homónimos.

---

## Testes e Validação

Para executar a suite completa de testes automatizados:

```powershell
# Testes do motor de simulação e regras HL7 portuguesas
.\venv\Scripts\python.exe -m unittest tools\data-generation\tests\test_generator.py

# Testes da API REST FastAPI e subscrições
.\venv\Scripts\python.exe -m unittest tools\data-generation\tests\test_api.py

# Todos os testes em simultâneo
.\venv\Scripts\python.exe -m unittest discover -s tools\data-generation\tests -p "test_*.py"
```

O validador independente (`pfgen/validate.py`) verifica automaticamente:
- Validade e unicidade estrita de cada `MSH-10` (UUIDv4).
- Unicidade e consistência de `PID-3` (NS/SNS) com `PID-5` (Nome) e `PID-18` (Processo).
- Ciclo de vida dos episódios `PV1-19` (A01 -> A02* -> A03).
- Replay da ocupação física das camas: **garante matematicamente que nenhuma cama tem dois pacientes em simultâneo**.
