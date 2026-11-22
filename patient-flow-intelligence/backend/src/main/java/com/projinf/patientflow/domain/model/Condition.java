package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.Objects;

@Entity
@Table(name = "conditions")
public class Condition {

    @Id
    @Column(name = "code", nullable = false, length = 32)
    private String code;

    @Column(name = "system", nullable = true, length = 16)
    private String system = "ICD10";

    @Column(name = "name", nullable = false)
    private String name;

    protected Condition() {
        // required by JPA
    }

    public Condition(String code, String system, String name) {
        this.code = code;
        this.system = system;
        this.name = name;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getSystem() {
        return system;
    }

    public void setSystem(String system) {
        this.system = system;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}