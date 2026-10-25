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
    @JoinColumn(name = "floor_id")
    private Floor floor;

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

    public Floor getFloor() { return floor; }

    public void setFloor(Floor floor) { this.floor = floor; }

    public List<Ward> getWards() { return wards; }

    public void setWards(List<Ward> wards) { this.wards = wards; }
}
