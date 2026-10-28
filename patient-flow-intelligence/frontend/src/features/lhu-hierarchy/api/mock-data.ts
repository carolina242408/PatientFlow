import type { OrgNode } from "../types/tree"

export const mockLHUNodes: OrgNode[] = [
  {
    id: "lhu-central",
    parentId: null,
    type: "lhu",
    name: "Central LHU",
    status: "operational",
    children: [
      {
        id: "unit-hospital",
        parentId: "lhu-central",
        type: "unit",
        name: "Hospital Unit",
        status: "operational",
        children: [
          {
            id: "bld-main",
            parentId: "unit-hospital",
            type: "building",
            name: "Main Building",
            status: "operational",
            children: [
              {
                id: "floor-3",
                parentId: "bld-main",
                type: "floor",
                name: "Floor 3",
                status: "operational",
                children: [
                  {
                    id: "ward-3",
                    parentId: "floor-3",
                    type: "ward",
                    name: "Ward 3 · Cardiology",
                    status: "operational",
                    children: [
                      {
                        id: "nursery-a",
                        parentId: "ward-3",
                        type: "nursery",
                        name: "Cardiology Nursery A",
                        status: "operational",
                        children: [
                          {
                            id: "room-301",
                            parentId: "nursery-a",
                            type: "room",
                            name: "Room 301",
                            status: "operational",
                            children: [
                              {
                                id: "beds-301",
                                parentId: "room-301",
                                type: "bed",
                                name: "Beds 1–6",
                                status: "5/6 occupied",
                              },
                            ],
                          },
                          {
                            id: "or-01",
                            parentId: "nursery-a",
                            type: "operating-room",
                            name: "Operating Room OR-01",
                            status: "operational",
                          },
                          {
                            id: "chairs-01-12",
                            parentId: "nursery-a",
                            type: "treatment-chair",
                            name: "Treatment Chairs 01–12",
                            status: "9/12 occupied",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "unit-community",
        parentId: "lhu-central",
        type: "unit",
        name: "Community Care Unit",
        status: "operational",
      },
    ],
  },
]
