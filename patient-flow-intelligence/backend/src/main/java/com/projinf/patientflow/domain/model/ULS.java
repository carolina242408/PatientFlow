package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "uls")
public class ULS {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String name;

    @OneToMany(mappedBy = "uls", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<HealthcareUnit> units = new ArrayList<>();

    public void addUnit(HealthcareUnit unit) {
        units.add(unit);
        unit.setUls(this);
    }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getName() { return name; }

    public void setName(String name) { this.name = name; }

    public List<HealthcareUnit> getUnits() { return units; }

    public void setUnits(List<HealthcareUnit> units) { this.units = units; }
}
