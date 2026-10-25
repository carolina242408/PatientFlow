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
    private List<Wing> wings = new ArrayList<>();

    public void addWing(Wing wing) {
        wings.add(wing);
        wing.setFloor(this);
    }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getLevelName() { return levelName; }

    public void setLevelName(String levelName) { this.levelName = levelName; }

    public Building getBuilding() { return building; }

    public void setBuilding(Building building) { this.building = building; }

    public List<Wing> getWings() { return wings; }

    public void setWings(List<Wing> wings) { this.wings = wings; }
}
