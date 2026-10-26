/**
 * Cruise performance for the whole roster, solved ahead of time.
 *
 * GENERATED FILE - do not edit by hand. Run `npm run dataset` to rebuild it.
 *
 * Every number here comes from the same code the application runs: the aircraft is
 * built, trimmed to its cruise weight with no pitching moment left over, and the wake
 * integrated in the Trefftz plane. It is committed rather than computed in the browser
 * because a trimmed solve is about a second and a half per aircraft and the chart wants
 * all of them at once.
 *
 * `tests/cruiseDataset.test.ts` recomputes the roster on every test run and fails if
 * anything here has drifted, so this file cannot silently fall behind the model.
 */

export interface CruiseDatum {
  id: string;
  year: number;
  /** Simulated: from the trimmed vortex lattice. */
  spanEfficiency: number;
  angleDeg: number;
  stabiliserDeg: number;
  tailLiftFraction: number;
  liftCoefficient: number;
  /** Derived: simulated induced drag plus correlated parasite and wave drag. */
  liftToDrag: number;
  /** Published: the book figure, for comparison only. */
  publishedLiftToDrag: number;
  fuelPerSeat100km: number;
  fuelPerKm: number;
  induced: number;
  parasite: number;
  wave: number;
  totalDrag: number;
  parasiteParts: Array<{ name: string; force: number }>;
  wettedAreaM2: number;
  divergenceMach: number;
  /** False when the correlations do not describe this aircraft's cruise. */
  applicable: boolean;
  limitation?: string;
  trustworthy: boolean;
}

export const CRUISE_DATASET: CruiseDatum[] = [
  {
    "id": "comet1",
    "year": 1949,
    "spanEfficiency": 0.974568,
    "angleDeg": 0.855427,
    "stabiliserDeg": -1.36149,
    "tailLiftFraction": -0.120515,
    "liftCoefficient": 0.270391,
    "liftToDrag": 15.827,
    "publishedLiftToDrag": 13.5,
    "fuelPerSeat100km": 8.47848,
    "fuelPerKm": 3.73053,
    "induced": 5542.82,
    "parasite": 20481.1,
    "wave": 0,
    "totalDrag": 26023.9,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 10412.2
      },
      {
        "name": "fuselage",
        "force": 4037.86
      },
      {
        "name": "nacelle",
        "force": 2074
      },
      {
        "name": "tailplane",
        "force": 1827.62
      },
      {
        "name": "fin",
        "force": 1099.96
      },
      {
        "name": "leakage",
        "force": 787.734
      },
      {
        "name": "other",
        "force": 241.681
      }
    ],
    "wettedAreaM2": 773.658,
    "divergenceMach": 0.753055,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "caravelle",
    "year": 1955,
    "spanEfficiency": 1.02236,
    "angleDeg": 1.18493,
    "stabiliserDeg": -0.138275,
    "tailLiftFraction": -0.049064,
    "liftCoefficient": 0.318372,
    "liftToDrag": 16.1121,
    "publishedLiftToDrag": 13,
    "fuelPerSeat100km": 3.80911,
    "fuelPerKm": 3.04729,
    "induced": 4969.68,
    "parasite": 19985,
    "wave": 0,
    "totalDrag": 24954.6,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 8592.68
      },
      {
        "name": "fuselage",
        "force": 4952.66
      },
      {
        "name": "tailplane",
        "force": 2003.74
      },
      {
        "name": "nacelle",
        "force": 1330.26
      },
      {
        "name": "fin",
        "force": 1307.38
      },
      {
        "name": "other",
        "force": 1029.59
      },
      {
        "name": "leakage",
        "force": 768.652
      }
    ],
    "wettedAreaM2": 725.33,
    "divergenceMach": 0.74161,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing707",
    "year": 1957,
    "spanEfficiency": 1.06934,
    "angleDeg": 3.45048,
    "stabiliserDeg": -2.21303,
    "tailLiftFraction": -0.0534561,
    "liftCoefficient": 0.399583,
    "liftToDrag": 17.7672,
    "publishedLiftToDrag": 15.5,
    "fuelPerSeat100km": 4.05624,
    "fuelPerKm": 5.55704,
    "induced": 16249,
    "parasite": 37842.4,
    "wave": 0,
    "totalDrag": 54091.4,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 15421.9
      },
      {
        "name": "fuselage",
        "force": 9242.69
      },
      {
        "name": "tailplane",
        "force": 3609.79
      },
      {
        "name": "nacelle",
        "force": 3571.6
      },
      {
        "name": "fin",
        "force": 2746.29
      },
      {
        "name": "other",
        "force": 1794.7
      },
      {
        "name": "leakage",
        "force": 1455.48
      }
    ],
    "wettedAreaM2": 1209.65,
    "divergenceMach": 0.804756,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "dc8",
    "year": 1958,
    "spanEfficiency": 0.981959,
    "angleDeg": 2.80249,
    "stabiliserDeg": -1.53688,
    "tailLiftFraction": -0.0482931,
    "liftCoefficient": 0.36821,
    "liftToDrag": 17.652,
    "publishedLiftToDrag": 15.8,
    "fuelPerSeat100km": 3.31856,
    "fuelPerKm": 5.87385,
    "induced": 17280.8,
    "parasite": 42629.6,
    "wave": 89.5113,
    "totalDrag": 59999.9,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 18185.9
      },
      {
        "name": "fuselage",
        "force": 9932.63
      },
      {
        "name": "tailplane",
        "force": 4012.78
      },
      {
        "name": "nacelle",
        "force": 3936.97
      },
      {
        "name": "fin",
        "force": 2970.31
      },
      {
        "name": "other",
        "force": 1951.42
      },
      {
        "name": "leakage",
        "force": 1639.6
      }
    ],
    "wettedAreaM2": 1292.5,
    "divergenceMach": 0.784682,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing727",
    "year": 1963,
    "spanEfficiency": 1.0174,
    "angleDeg": 3.52446,
    "stabiliserDeg": -1.81497,
    "tailLiftFraction": -0.0284621,
    "liftCoefficient": 0.419268,
    "liftToDrag": 16.3198,
    "publishedLiftToDrag": 15,
    "fuelPerSeat100km": 3.12615,
    "fuelPerKm": 4.65796,
    "induced": 15744,
    "parasite": 34732.2,
    "wave": 0,
    "totalDrag": 50476.1,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 12346.4
      },
      {
        "name": "fuselage",
        "force": 11280.8
      },
      {
        "name": "fin",
        "force": 3479.19
      },
      {
        "name": "tailplane",
        "force": 2730.84
      },
      {
        "name": "nacelle",
        "force": 2215.8
      },
      {
        "name": "other",
        "force": 1343.24
      },
      {
        "name": "leakage",
        "force": 1335.85
      }
    ],
    "wettedAreaM2": 1014.6,
    "divergenceMach": 0.832641,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing737-200",
    "year": 1967,
    "spanEfficiency": 1.01947,
    "angleDeg": 4.41002,
    "stabiliserDeg": -2.58601,
    "tailLiftFraction": -0.0387978,
    "liftCoefficient": 0.46564,
    "liftToDrag": 15.9389,
    "publishedLiftToDrag": 15,
    "fuelPerSeat100km": 2.53269,
    "fuelPerKm": 2.9126,
    "induced": 7429.8,
    "parasite": 20872.4,
    "wave": 0,
    "totalDrag": 28302.2,
    "parasiteParts": [
      {
        "name": "fuselage",
        "force": 6900.09
      },
      {
        "name": "wing",
        "force": 6723.87
      },
      {
        "name": "tailplane",
        "force": 2201.03
      },
      {
        "name": "fin",
        "force": 1752.92
      },
      {
        "name": "nacelle",
        "force": 1659.85
      },
      {
        "name": "other",
        "force": 831.814
      },
      {
        "name": "leakage",
        "force": 802.783
      }
    ],
    "wettedAreaM2": 642.517,
    "divergenceMach": 0.780668,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing747-100",
    "year": 1969,
    "spanEfficiency": 1.03758,
    "angleDeg": 5.20374,
    "stabiliserDeg": -3.35466,
    "tailLiftFraction": -0.0401596,
    "liftCoefficient": 0.474968,
    "liftToDrag": 18.221,
    "publishedLiftToDrag": 17,
    "fuelPerSeat100km": 3.05656,
    "fuelPerKm": 11.187,
    "induced": 59532.7,
    "parasite": 96546.9,
    "wave": 0,
    "totalDrag": 156080,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 34880.9
      },
      {
        "name": "fuselage",
        "force": 27765.7
      },
      {
        "name": "nacelle",
        "force": 11162.1
      },
      {
        "name": "tailplane",
        "force": 8905.97
      },
      {
        "name": "fin",
        "force": 6261.27
      },
      {
        "name": "other",
        "force": 3857.58
      },
      {
        "name": "leakage",
        "force": 3713.34
      }
    ],
    "wettedAreaM2": 3074.81,
    "divergenceMach": 0.847963,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "concorde",
    "year": 1969,
    "spanEfficiency": 0.972105,
    "angleDeg": 6.82015,
    "stabiliserDeg": 0,
    "tailLiftFraction": 0,
    "liftCoefficient": 0.214219,
    "liftToDrag": 0.0365593,
    "publishedLiftToDrag": 7.5,
    "fuelPerSeat100km": 2437.32,
    "fuelPerKm": 2437.32,
    "induced": 60164.6,
    "parasite": 63142.3,
    "wave": 42795000,
    "totalDrag": 42918400,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 32925
      },
      {
        "name": "fuselage",
        "force": 13973.5
      },
      {
        "name": "nacelle",
        "force": 7010.57
      },
      {
        "name": "fin",
        "force": 6074.05
      },
      {
        "name": "leakage",
        "force": 2428.55
      },
      {
        "name": "other",
        "force": 730.682
      }
    ],
    "wettedAreaM2": 1468.93,
    "divergenceMach": 1.28482,
    "applicable": false,
    "limitation": "Cruise at Mach 2.02 is beyond these correlations, which describe the start of the transonic drag rise and not supersonic flight. Supersonic wave drag comes from the volume distribution along the aircraft and needs a different calculation.",
    "trustworthy": false
  },
  {
    "id": "a300",
    "year": 1972,
    "spanEfficiency": 1.03321,
    "angleDeg": 4.81088,
    "stabiliserDeg": -2.69907,
    "tailLiftFraction": -0.0318187,
    "liftCoefficient": 0.541316,
    "liftToDrag": 17.5352,
    "publishedLiftToDrag": 16.5,
    "fuelPerSeat100km": 2.35315,
    "fuelPerKm": 6.25938,
    "induced": 30665.2,
    "parasite": 50427,
    "wave": 0,
    "totalDrag": 81092.1,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 16619.6
      },
      {
        "name": "fuselage",
        "force": 16347.8
      },
      {
        "name": "nacelle",
        "force": 5208.64
      },
      {
        "name": "tailplane",
        "force": 4739.07
      },
      {
        "name": "fin",
        "force": 3778.37
      },
      {
        "name": "leakage",
        "force": 1939.5
      },
      {
        "name": "other",
        "force": 1793.96
      }
    ],
    "wettedAreaM2": 1775.96,
    "divergenceMach": 0.788248,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "md80",
    "year": 1979,
    "spanEfficiency": 0.994601,
    "angleDeg": 4.80505,
    "stabiliserDeg": -2.76965,
    "tailLiftFraction": -0.0212284,
    "liftCoefficient": 0.546248,
    "liftToDrag": 16.9629,
    "publishedLiftToDrag": 16,
    "fuelPerSeat100km": 2.05426,
    "fuelPerKm": 3.18411,
    "induced": 10691.6,
    "parasite": 23995.8,
    "wave": 0,
    "totalDrag": 34687.4,
    "parasiteParts": [
      {
        "name": "fuselage",
        "force": 7706.29
      },
      {
        "name": "wing",
        "force": 7318.41
      },
      {
        "name": "tailplane",
        "force": 2522.4
      },
      {
        "name": "fin",
        "force": 2396.99
      },
      {
        "name": "nacelle",
        "force": 1785.91
      },
      {
        "name": "other",
        "force": 1342.84
      },
      {
        "name": "leakage",
        "force": 922.914
      }
    ],
    "wettedAreaM2": 860.416,
    "divergenceMach": 0.776948,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing767",
    "year": 1981,
    "spanEfficiency": 1.01821,
    "angleDeg": 3.70096,
    "stabiliserDeg": -1.93335,
    "tailLiftFraction": -0.0574334,
    "liftCoefficient": 0.447432,
    "liftToDrag": 17.8291,
    "publishedLiftToDrag": 17.5,
    "fuelPerSeat100km": 2.29172,
    "fuelPerKm": 4.95011,
    "induced": 21466,
    "parasite": 47288.4,
    "wave": 0,
    "totalDrag": 68754.5,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 17246.7
      },
      {
        "name": "fuselage",
        "force": 12811.4
      },
      {
        "name": "tailplane",
        "force": 5433.55
      },
      {
        "name": "nacelle",
        "force": 4678.27
      },
      {
        "name": "fin",
        "force": 3727.53
      },
      {
        "name": "leakage",
        "force": 1818.79
      },
      {
        "name": "other",
        "force": 1572.19
      }
    ],
    "wettedAreaM2": 1668.68,
    "divergenceMach": 0.890696,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing757",
    "year": 1982,
    "spanEfficiency": 1.00796,
    "angleDeg": 4.92275,
    "stabiliserDeg": -2.48175,
    "tailLiftFraction": -0.0351799,
    "liftCoefficient": 0.552875,
    "liftToDrag": 17.6654,
    "publishedLiftToDrag": 17,
    "fuelPerSeat100km": 1.9511,
    "fuelPerKm": 3.9022,
    "induced": 22127.1,
    "parasite": 33941.5,
    "wave": 0,
    "totalDrag": 56068.6,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 11635.4
      },
      {
        "name": "fuselage",
        "force": 9073.3
      },
      {
        "name": "nacelle",
        "force": 3895.91
      },
      {
        "name": "tailplane",
        "force": 3818.24
      },
      {
        "name": "fin",
        "force": 2831.57
      },
      {
        "name": "other",
        "force": 1381.63
      },
      {
        "name": "leakage",
        "force": 1305.44
      }
    ],
    "wettedAreaM2": 1180.24,
    "divergenceMach": 0.843066,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "a320",
    "year": 1987,
    "spanEfficiency": 1.03063,
    "angleDeg": 5.61668,
    "stabiliserDeg": -3.41608,
    "tailLiftFraction": -0.0331247,
    "liftCoefficient": 0.591661,
    "liftToDrag": 18.0472,
    "publishedLiftToDrag": 17,
    "fuelPerSeat100km": 1.81902,
    "fuelPerKm": 2.72854,
    "induced": 12847.8,
    "parasite": 24102.7,
    "wave": 0,
    "totalDrag": 36950.5,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 7832.16
      },
      {
        "name": "fuselage",
        "force": 7524.25
      },
      {
        "name": "nacelle",
        "force": 2572.87
      },
      {
        "name": "tailplane",
        "force": 2505.37
      },
      {
        "name": "fin",
        "force": 1869.89
      },
      {
        "name": "leakage",
        "force": 927.027
      },
      {
        "name": "other",
        "force": 871.126
      }
    ],
    "wettedAreaM2": 861.633,
    "divergenceMach": 0.834813,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "a340",
    "year": 1991,
    "spanEfficiency": 1.02545,
    "angleDeg": 6.28462,
    "stabiliserDeg": -4.11472,
    "tailLiftFraction": -0.0300197,
    "liftCoefficient": 0.637971,
    "liftToDrag": 21.4557,
    "publishedLiftToDrag": 18,
    "fuelPerSeat100km": 2.4813,
    "fuelPerKm": 7.31985,
    "induced": 46543.8,
    "parasite": 63151.7,
    "wave": 0,
    "totalDrag": 109695,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 22345.4
      },
      {
        "name": "fuselage",
        "force": 19014.2
      },
      {
        "name": "tailplane",
        "force": 7338.36
      },
      {
        "name": "nacelle",
        "force": 5427.43
      },
      {
        "name": "fin",
        "force": 4812.02
      },
      {
        "name": "leakage",
        "force": 2428.91
      },
      {
        "name": "other",
        "force": 1785.38
      }
    ],
    "wettedAreaM2": 2230.9,
    "divergenceMach": 0.85541,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing777",
    "year": 1994,
    "spanEfficiency": 0.991242,
    "angleDeg": 3.87642,
    "stabiliserDeg": -2.12994,
    "tailLiftFraction": -0.0533468,
    "liftCoefficient": 0.462256,
    "liftToDrag": 18.7289,
    "publishedLiftToDrag": 19,
    "fuelPerSeat100km": 2.31997,
    "fuelPerKm": 7.07592,
    "induced": 36065.4,
    "parasite": 76511,
    "wave": 0,
    "totalDrag": 112576,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 27318.9
      },
      {
        "name": "fuselage",
        "force": 21911
      },
      {
        "name": "nacelle",
        "force": 8511.37
      },
      {
        "name": "tailplane",
        "force": 7686.71
      },
      {
        "name": "fin",
        "force": 5628.5
      },
      {
        "name": "leakage",
        "force": 2942.73
      },
      {
        "name": "other",
        "force": 2511.78
      }
    ],
    "wettedAreaM2": 2578.15,
    "divergenceMach": 0.885489,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing737-800",
    "year": 1997,
    "spanEfficiency": 1.01544,
    "angleDeg": 5.3123,
    "stabiliserDeg": -3.12875,
    "tailLiftFraction": -0.0313724,
    "liftCoefficient": 0.583224,
    "liftToDrag": 18.1582,
    "publishedLiftToDrag": 18,
    "fuelPerSeat100km": 1.68778,
    "fuelPerKm": 2.7342,
    "induced": 12033.6,
    "parasite": 25231,
    "wave": 0,
    "totalDrag": 37264.6,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 8296.75
      },
      {
        "name": "fuselage",
        "force": 7510.44
      },
      {
        "name": "tailplane",
        "force": 2898.9
      },
      {
        "name": "nacelle",
        "force": 2626.11
      },
      {
        "name": "fin",
        "force": 2024.07
      },
      {
        "name": "leakage",
        "force": 970.425
      },
      {
        "name": "other",
        "force": 904.335
      }
    ],
    "wettedAreaM2": 893.456,
    "divergenceMach": 0.837772,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "a380",
    "year": 2005,
    "spanEfficiency": 1.01612,
    "angleDeg": 6.51101,
    "stabiliserDeg": -4.40198,
    "tailLiftFraction": -0.0572224,
    "liftCoefficient": 0.584264,
    "liftToDrag": 20.5807,
    "publishedLiftToDrag": 19,
    "fuelPerSeat100km": 2.52101,
    "fuelPerKm": 13.9916,
    "induced": 119234,
    "parasite": 119014,
    "wave": 0,
    "totalDrag": 238248,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 47018.8
      },
      {
        "name": "fuselage",
        "force": 29849.3
      },
      {
        "name": "tailplane",
        "force": 13328.6
      },
      {
        "name": "nacelle",
        "force": 11876.6
      },
      {
        "name": "fin",
        "force": 8676.64
      },
      {
        "name": "leakage",
        "force": 4577.47
      },
      {
        "name": "other",
        "force": 3686.83
      }
    ],
    "wettedAreaM2": 4292.13,
    "divergenceMach": 0.876699,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing787",
    "year": 2009,
    "spanEfficiency": 0.924117,
    "angleDeg": 5.44109,
    "stabiliserDeg": -3.53182,
    "tailLiftFraction": -0.0451553,
    "liftCoefficient": 0.543706,
    "liftToDrag": 20.3798,
    "publishedLiftToDrag": 20.5,
    "fuelPerSeat100km": 2.24541,
    "fuelPerKm": 5.43389,
    "induced": 37929.5,
    "parasite": 57347,
    "wave": 0,
    "totalDrag": 95276.5,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 21215.7
      },
      {
        "name": "fuselage",
        "force": 16650.5
      },
      {
        "name": "tailplane",
        "force": 6005.33
      },
      {
        "name": "nacelle",
        "force": 5448.8
      },
      {
        "name": "fin",
        "force": 4103.92
      },
      {
        "name": "leakage",
        "force": 2205.65
      },
      {
        "name": "other",
        "force": 1717.08
      }
    ],
    "wettedAreaM2": 2111.85,
    "divergenceMach": 0.882811,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "a350",
    "year": 2013,
    "spanEfficiency": 0.982279,
    "angleDeg": 6.28464,
    "stabiliserDeg": -4.15226,
    "tailLiftFraction": -0.0379776,
    "liftCoefficient": 0.60163,
    "liftToDrag": 21.1862,
    "publishedLiftToDrag": 21,
    "fuelPerSeat100km": 1.9435,
    "fuelPerKm": 6.12203,
    "induced": 49382.6,
    "parasite": 64022.9,
    "wave": 0,
    "totalDrag": 113406,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 23535.9
      },
      {
        "name": "fuselage",
        "force": 18996.5
      },
      {
        "name": "tailplane",
        "force": 6895.65
      },
      {
        "name": "nacelle",
        "force": 5638.39
      },
      {
        "name": "fin",
        "force": 4699.27
      },
      {
        "name": "leakage",
        "force": 2462.42
      },
      {
        "name": "other",
        "force": 1794.78
      }
    ],
    "wettedAreaM2": 2527.67,
    "divergenceMach": 0.872917,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "a320neo",
    "year": 2014,
    "spanEfficiency": 1.03764,
    "angleDeg": 5.61126,
    "stabiliserDeg": -3.42286,
    "tailLiftFraction": -0.0324647,
    "liftCoefficient": 0.600362,
    "liftToDrag": 18.2109,
    "publishedLiftToDrag": 18,
    "fuelPerSeat100km": 1.41346,
    "fuelPerKm": 2.33221,
    "induced": 11920.9,
    "parasite": 25235.9,
    "wave": 0,
    "totalDrag": 37156.9,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 8031.2
      },
      {
        "name": "fuselage",
        "force": 7524.25
      },
      {
        "name": "nacelle",
        "force": 3265.99
      },
      {
        "name": "tailplane",
        "force": 2505.37
      },
      {
        "name": "fin",
        "force": 1869.89
      },
      {
        "name": "other",
        "force": 1068.62
      },
      {
        "name": "leakage",
        "force": 970.613
      }
    ],
    "wettedAreaM2": 892.339,
    "divergenceMach": 0.833644,
    "applicable": true,
    "trustworthy": true
  },
  {
    "id": "boeing737max",
    "year": 2016,
    "spanEfficiency": 1.03394,
    "angleDeg": 5.74247,
    "stabiliserDeg": -3.48537,
    "tailLiftFraction": -0.0298518,
    "liftCoefficient": 0.589547,
    "liftToDrag": 18.3078,
    "publishedLiftToDrag": 18.5,
    "fuelPerSeat100km": 1.34274,
    "fuelPerKm": 2.39008,
    "induced": 12614.1,
    "parasite": 25953,
    "wave": 0,
    "totalDrag": 38567.1,
    "parasiteParts": [
      {
        "name": "wing",
        "force": 8190.78
      },
      {
        "name": "fuselage",
        "force": 7603.13
      },
      {
        "name": "tailplane",
        "force": 3109.95
      },
      {
        "name": "nacelle",
        "force": 2900.35
      },
      {
        "name": "fin",
        "force": 2174.55
      },
      {
        "name": "leakage",
        "force": 998.194
      },
      {
        "name": "other",
        "force": 976.095
      }
    ],
    "wettedAreaM2": 904.258,
    "divergenceMach": 0.836923,
    "applicable": true,
    "trustworthy": true
  }
];

export function cruiseDatumFor(id: string): CruiseDatum | undefined {
  return CRUISE_DATASET.find((entry) => entry.id === id);
}
