package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "clinical_services", uniqueConstraints = @UniqueConstraint(columnNames = {"floor_id", "code"}))
public class ClinicalService {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "floor_id")
    private Floor floor;

    @Column(nullable = false)
    private String code;

    @Column(nullable = false)
    private String name;

    @OneToMany(mappedBy = "service", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Wing> wings = new ArrayList<>();

    public void addWing(Wing wing) {
        wings.add(wing);
        wing.setService(this);
    }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public Floor getFloor() { return floor; }

    public void setFloor(Floor floor) { this.floor = floor; }

    public String getCode() { return code; }

    public void setCode(String code) { this.code = code; }

    public String getName() { return name; }

    public void setName(String name) { this.name = name; }

    public List<Wing> getWings() { return wings; }

    public void setWings(List<Wing> wings) { this.wings = wings; }
}