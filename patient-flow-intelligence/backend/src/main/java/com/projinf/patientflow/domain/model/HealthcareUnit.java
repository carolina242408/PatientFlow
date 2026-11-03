package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "healthcare_units")
public class HealthcareUnit {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String name;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "uls_id")
    private ULS uls;

    @OneToMany(mappedBy = "unit", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Building> buildings = new ArrayList<>();

    public void addBuilding(Building building) {
        buildings.add(building);
        building.setUnit(this);
    }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getName() { return name; }

    public void setName(String name) { this.name = name; }

    public ULS getUls() { return uls; }

    public void setUls(ULS uls) { this.uls = uls; }

    public List<Building> getBuildings() { return buildings; }

    public void setBuildings(List<Building> buildings) { this.buildings = buildings; }
}
