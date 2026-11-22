FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -B package
COPY docker/Healthcheck.java ./Healthcheck.java
RUN javac --release 21 Healthcheck.java

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pydantic \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/patientflow-0.0.1-SNAPSHOT.jar app.jar
COPY --from=build /build/Healthcheck.class Healthcheck.class
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
