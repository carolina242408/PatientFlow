package com.projinf.patientflow.web;

import com.projinf.patientflow.event.EventTickets;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/events")
public class EventTicketController {
    private final EventTickets tickets;
    public EventTicketController(EventTickets tickets) { this.tickets=tickets; }
    @PostMapping("/tickets")
    public ResponseEntity<EventTickets.TicketResponse> issue() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(tickets.issue());
    }
}
