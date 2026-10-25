package com.projinf.patientflow.repository.jpa;

import com.projinf.patientflow.domain.model.Bed;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface BedJpaRepository extends JpaRepository<Bed, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from Bed b where b.id = :id")
    Optional<Bed> lockById(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from Bed b where b.code = :bed and b.room.code = :room and b.room.ward.code = :ward")
    Optional<Bed> lockByHierarchy(@Param("ward") String ward, @Param("room") String room, @Param("bed") String bed);

    @Query("""
           select b from Bed b
           where b.code = :bedCode
             and b.room.code = :roomCode
             and b.room.ward.code = :wardCode
           """)
    Optional<Bed> findByHierarchy(@Param("wardCode") String wardCode,
                                  @Param("roomCode") String roomCode,
                                  @Param("bedCode") String bedCode);
}
