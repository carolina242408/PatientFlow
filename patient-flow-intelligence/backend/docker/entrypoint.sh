#!/bin/sh
set -e

if [ -f /app/certs/localhostCertificate.pem ]; then
    echo "Importing /app/certs/localhostCertificate.pem into Java truststore..."
    keytool -delete -alias keycloak-local \
        -keystore /opt/java/openjdk/lib/security/cacerts \
        -storepass changeit 2>/dev/null || true

    keytool -importcert -noprompt \
        -alias keycloak-local \
        -keystore /opt/java/openjdk/lib/security/cacerts \
        -storepass changeit \
        -file /app/certs/localhostCertificate.pem
fi

exec java -jar /app/app.jar "$@"
