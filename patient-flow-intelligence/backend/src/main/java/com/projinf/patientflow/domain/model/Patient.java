package com.projinf.patientflow.domain.model;

import jakarta.persistence.*;

import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "patients")
public class Patient {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "sns_number", nullable = false, unique = true)
    private String snsNumber;

    @Column(name = "hospital_number")
    private String hospitalNumber;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    @Column(name = "birth_date")
    private LocalDate birthDate;

    private String gender;

    @Version
    private long version;

    public long getVersion() { return version; }

    public UUID getId() { return id; }

    public void setId(UUID id) { this.id = id; }

    public String getSnsNumber() { return snsNumber; }

    public void setSnsNumber(String snsNumber) { this.snsNumber = snsNumber; }

    public String getHospitalNumber() { return hospitalNumber; }

    public void setHospitalNumber(String hospitalNumber) { this.hospitalNumber = hospitalNumber; }

    public String getFullName() { return fullName; }

    public void setFullName(String fullName) { this.fullName = fullName; }

    public LocalDate getBirthDate() { return birthDate; }

    public void setBirthDate(LocalDate birthDate) { this.birthDate = birthDate; }

    public String getGender() { return gender; }

    public void setGender(String gender) { this.gender = gender; }
}
