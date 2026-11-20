package com.projinf.patientflow.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI patientFlowOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("Patient Flow Intelligence API")
                .description("API de gestão operacional, ingestão FHIR e análise do fluxo de doentes.")
                .version("1.0.0")
                .contact(new Contact().name("Patient Flow Intelligence")))
            .components(new Components()
                .addSecuritySchemes("bearerAuth", new SecurityScheme()
                    .type(SecurityScheme.Type.HTTP)
                    .scheme("bearer")
                    .bearerFormat("JWT")));
    }
}
