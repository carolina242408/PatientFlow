package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "wards")
public class Ward {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** ex: "Ward 30004" */
    @Column(nullable = false, unique = true)
    private String code;

    @Column(nullable = false)
    private String name;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "wing_id")
    private Wing wing;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "service_id")
    private ClinicalService service;

    public ClinicalService getService() { return service; }
    public void setService(ClinicalService service) { this.service = service; }

    @OneToMany(mappedBy = "ward", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Room> rooms = new ArrayList<>();

    public void addRoom(Room room) {
        rooms.add(room);
        room.setWard(this);
    }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getCode() { return code; }

    public void setCode(String code) { this.code = code; }

    public String getName() { return name; }

    public void setName(String name) { this.name = name; }

    public Wing getWing() { return wing; }

    public void setWing(Wing wing) { this.wing = wing; }

    public List<Room> getRooms() { return rooms; }

    public void setRooms(List<Room> rooms) { this.rooms = rooms; }
}
