package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.util.UUID;

@Entity
@Table(name = "beds", uniqueConstraints = @UniqueConstraint(columnNames = {"room_id", "code"}))
public class Bed {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** ex: "Bed MAC" */
    @Column(nullable = false)
    private String code;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "room_id")
    private Room room;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private BedStatus status = BedStatus.AVAILABLE;

    @Version
    private long version;

    @Column(name = "status_reason")
    private String statusReason;

    public long getVersion() { return version; }
    public String getStatusReason() { return statusReason; }
    public void setStatusReason(String statusReason) { this.statusReason = statusReason; }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getCode() { return code; }

    public void setCode(String code) { this.code = code; }

    public Room getRoom() { return room; }

    public void setRoom(Room room) { this.room = room; }

    public BedStatus getStatus() { return status; }

    public void setStatus(BedStatus status) { this.status = status; }
}
