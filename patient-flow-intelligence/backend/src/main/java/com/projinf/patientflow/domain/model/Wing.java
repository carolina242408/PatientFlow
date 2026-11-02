package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "wings")
public class Wing {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String name;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "service_id")
    private ClinicalService service;

    @OneToMany(mappedBy = "wing", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Ward> wards = new ArrayList<>();

    public void addWard(Ward ward) {
        wards.add(ward);
        ward.setWing(this);
    }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getName() { return name; }

    public void setName(String name) { this.name = name; }

    public ClinicalService getService() { return service; }

    public void setService(ClinicalService service) { this.service = service; }

    public List<Ward> getWards() { return wards; }

    public void setWards(List<Ward> wards) { this.wards = wards; }
}