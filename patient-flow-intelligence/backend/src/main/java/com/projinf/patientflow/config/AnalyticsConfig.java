package com.projinf.patientflow.config;

import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(AnalyticsSettings.class)
public class AnalyticsConfig {
    @Bean public Clock analyticsClock() { return Clock.systemUTC(); }
}
