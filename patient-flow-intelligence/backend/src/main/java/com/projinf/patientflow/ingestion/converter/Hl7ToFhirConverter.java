package com.projinf.patientflow.ingestion.converter;

import jakarta.annotation.PreDestroy;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Invokes the packaged Python HL7-to-FHIR converter (`tools/hl7-fhir-converter`)
 * via a persistent stdin/stdout worker process to translate HL7 v2.x ADT messages
 * into FHIR R4 Bundles.
 */
@Component
public class Hl7ToFhirConverter {

    private static final Logger log = LoggerFactory.getLogger(Hl7ToFhirConverter.class);

    private final JsonMapper json;
    private final String pythonExecutable;
    private final Path converterScript;

    private Process workerProcess;
    private BufferedWriter workerStdin;
    private BufferedReader workerStdout;

    @Autowired
    public Hl7ToFhirConverter(
            JsonMapper json,
            @Value("${patientflow.ingestion.converter-python:}") String configuredPython,
            @Value("${patientflow.ingestion.converter-script:}") String configuredScript) {
        this.json = json;
        this.pythonExecutable = resolvePythonExecutable(configuredPython);
        this.converterScript = resolveConverterScript(configuredScript);
        log.info("Initialized Python HL7-to-FHIR converter using python='{}' and script='{}'",
                this.pythonExecutable, this.converterScript);
    }

    public Hl7ToFhirConverter(JsonMapper json) {
        this(json, "", "");
    }

    public Hl7ToFhirConverter() {
        this(JsonMapper.builder().build(), "", "");
    }

    public boolean isHl7Message(String payload) {
        return payload != null && payload.trim().startsWith("MSH|");
    }

    public synchronized ObjectNode convert(String hl7Message) {
        if (!isHl7Message(hl7Message)) {
            throw new IllegalArgumentException("HL7 message must start with an MSH segment");
        }

        try {
            ensureWorkerStarted();
            ObjectNode req = json.createObjectNode();
            req.put("hl7", hl7Message);

            workerStdin.write(json.writeValueAsString(req));
            workerStdin.newLine();
            workerStdin.flush();

            String responseLine = workerStdout.readLine();
            if (responseLine == null) {
                stopWorker();
                throw new IllegalStateException("Python HL7-to-FHIR converter worker closed unexpectedly");
            }

            JsonNode res = json.readTree(responseLine);
            if (!res.path("ok").asBoolean(false)) {
                throw new IllegalArgumentException("Python HL7-to-FHIR converter error: "
                        + res.path("error").asString("Unknown error"));
            }

            JsonNode bundle = res.path("bundle");
            if (!bundle.isObject() || !"Bundle".equals(bundle.path("resourceType").asString())) {
                throw new IllegalStateException("Converter did not return a valid FHIR Bundle JSON");
            }
            return (ObjectNode) bundle;
        } catch (IOException ex) {
            stopWorker();
            throw new IllegalStateException("Failed to communicate with Python HL7-to-FHIR converter: " + ex.getMessage(), ex);
        }
    }

    private void ensureWorkerStarted() throws IOException {
        if (workerProcess != null && workerProcess.isAlive()) {
            return;
        }
        ProcessBuilder pb = new ProcessBuilder(
                pythonExecutable,
                "-u",
                converterScript.toAbsolutePath().toString(),
                "--worker"
        );
        if (converterScript.getParent() != null) {
            pb.directory(converterScript.getParent().toFile());
        }
        pb.environment().put("PYTHONIOENCODING", "utf-8");
        workerProcess = pb.start();
        workerStdin = new BufferedWriter(new OutputStreamWriter(workerProcess.getOutputStream(), StandardCharsets.UTF_8));
        workerStdout = new BufferedReader(new InputStreamReader(workerProcess.getInputStream(), StandardCharsets.UTF_8));
    }

    @PreDestroy
    public synchronized void stopWorker() {
        if (workerProcess != null) {
            workerProcess.destroyForcibly();
            workerProcess = null;
            workerStdin = null;
            workerStdout = null;
        }
    }

    private static String resolvePythonExecutable(String configured) {
        if (configured != null && !configured.isBlank()) {
            return configured.trim();
        }
        String env = System.getenv("HL7_CONVERTER_PYTHON");
        if (env != null && !env.isBlank()) {
            return env.trim();
        }
        List<Path> candidates = List.of(
                Path.of("/opt/venv/bin/python"),
                Path.of("../../venv/Scripts/python.exe"),
                Path.of("../venv/Scripts/python.exe"),
                Path.of("venv/Scripts/python.exe"),
                Path.of("../../venv/bin/python"),
                Path.of("../venv/bin/python"),
                Path.of("venv/bin/python"));
        for (Path candidate : candidates) {
            if (Files.isExecutable(candidate) || Files.exists(candidate)) {
                return candidate.toAbsolutePath().normalize().toString();
            }
        }
        return System.getProperty("os.name", "").toLowerCase().contains("win") ? "python" : "python3";
    }

    private static Path resolveConverterScript(String configured) {
        if (configured != null && !configured.isBlank()) {
            return Path.of(configured.trim()).toAbsolutePath().normalize();
        }
        String env = System.getenv("HL7_CONVERTER_SCRIPT");
        if (env != null && !env.isBlank()) {
            return Path.of(env.trim()).toAbsolutePath().normalize();
        }
        List<Path> candidates = List.of(
                Path.of("/app/converter/main.py"),
                Path.of("../../tools/hl7-fhir-converter/main.py"),
                Path.of("../tools/hl7-fhir-converter/main.py"),
                Path.of("tools/hl7-fhir-converter/main.py")
        );
        for (Path candidate : candidates) {
            if (Files.exists(candidate)) {
                return candidate.toAbsolutePath().normalize();
            }
        }
        return Path.of("../../tools/hl7-fhir-converter/main.py").toAbsolutePath().normalize();
    }
}
