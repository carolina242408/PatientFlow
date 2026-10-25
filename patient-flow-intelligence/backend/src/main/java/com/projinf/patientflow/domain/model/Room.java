package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "rooms", uniqueConstraints = @UniqueConstraint(columnNames = {"ward_id", "code"}))
public class Room {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** ex: "Room 7005" */
    @Column(nullable = false)
    private String code;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ward_id")
    private Ward ward;

    @OneToMany(mappedBy = "room", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Bed> beds = new ArrayList<>();

    public void addBed(Bed bed) {
        beds.add(bed);
        bed.setRoom(this);
    }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getCode() { return code; }

    public void setCode(String code) { this.code = code; }

    public Ward getWard() { return ward; }

    public void setWard(Ward ward) { this.ward = ward; }

    public List<Bed> getBeds() { return beds; }

    public void setBeds(List<Bed> beds) { this.beds = beds; }
}
