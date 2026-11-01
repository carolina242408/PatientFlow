package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "floors")
public class Floor {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "level_name", nullable = false)
    private String levelName;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "building_id")
    private Building building;

    @OneToMany(mappedBy = "floor", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ClinicalService> services = new ArrayList<>();

    public void addService(ClinicalService service) {
        services.add(service);
        service.setFloor(this);
    }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getLevelName() { return levelName; }

    public void setLevelName(String levelName) { this.levelName = levelName; }

    public Building getBuilding() { return building; }

    public void setBuilding(Building building) { this.building = building; }

    public List<ClinicalService> getServices() { return services; }

    public void setServices(List<ClinicalService> services) { this.services = services; }
}