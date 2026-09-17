/**
 * International Standard Atmosphere, and the two dimensionless numbers that decide
 * whether a wind tunnel test means anything.
 *
 * Mach number says whether compressibility matters. Below about 0.3 air behaves as if
 * incompressible; by cruise Mach 0.85 the flow over the wing's upper surface is locally
 * supersonic, which is the whole reason swept wings and supercritical sections exist.
 *
 * Reynolds number is the ratio of inertial to viscous forces, and it is why a simulated
 * wind tunnel has to be honest about its limits. A real airliner at cruise sits around
 * 5e7. No browser resolves a boundary layer a hundred-thousandth of a chord thick, so
 * the number is worth showing precisely because it makes the gap explicit.
 */

/** Ratio of specific heats for air. */
const GAMMA = 1.4;
/** Specific gas constant for dry air, J/(kg K). */
const GAS_CONSTANT = 287.053;
const GRAVITY = 9.80665;
/** Temperature lapse rate in the troposphere, K/m. */
const LAPSE_RATE = 0.0065;
/** Top of the troposphere, m. */
const TROPOPAUSE = 11000;

export const SEA_LEVEL = {
  temperature: 288.15,
  pressure: 101325,
  density: 1.225,
  /** Dynamic viscosity, Pa s. */
  viscosity: 1.789e-5,
};

export interface AtmosphereState {
  /** Kelvin. */
  temperature: number;
  /** Pascals. */
  pressure: number;
  /** kg/m^3. */
  density: number;
  /** m/s. */
  speedOfSound: number;
}

/** Conditions at a given geopotential altitude, valid to 20 km. */
export function atmosphereAt(altitudeM: number): AtmosphereState {
  const h = Math.max(0, altitudeM);
  let temperature: number;
  let pressure: number;

  if (h <= TROPOPAUSE) {
    temperature = SEA_LEVEL.temperature - LAPSE_RATE * h;
    pressure =
      SEA_LEVEL.pressure *
      Math.pow(temperature / SEA_LEVEL.temperature, GRAVITY / (LAPSE_RATE * GAS_CONSTANT));
  } else {
    // Isothermal layer above the tropopause.
    temperature = SEA_LEVEL.temperature - LAPSE_RATE * TROPOPAUSE;
    const pressureAtTropopause =
      SEA_LEVEL.pressure *
      Math.pow(temperature / SEA_LEVEL.temperature, GRAVITY / (LAPSE_RATE * GAS_CONSTANT));
    pressure =
      pressureAtTropopause *
      Math.exp((-GRAVITY * (h - TROPOPAUSE)) / (GAS_CONSTANT * temperature));
  }

  return {
    temperature,
    pressure,
    density: pressure / (GAS_CONSTANT * temperature),
    speedOfSound: Math.sqrt(GAMMA * GAS_CONSTANT * temperature),
  };
}

/** Speed of sound at a temperature in Kelvin. */
export function speedOfSound(temperatureK: number): number {
  return Math.sqrt(GAMMA * GAS_CONSTANT * temperatureK);
}

/** Mach number for a speed, at the given conditions. */
export function machNumber(metresPerSecond: number, state: AtmosphereState): number {
  return metresPerSecond / state.speedOfSound;
}

/**
 * Reynolds number based on a reference length, normally the mean aerodynamic chord.
 * Viscosity follows Sutherland's law, which matters because it falls markedly at
 * cruise altitude temperatures.
 */
export function reynoldsNumber(
  metresPerSecond: number,
  referenceLengthM: number,
  state: AtmosphereState,
): number {
  return (state.density * metresPerSecond * referenceLengthM) / dynamicViscosity(state.temperature);
}

/** Sutherland's law for the dynamic viscosity of air, Pa s. */
export function dynamicViscosity(temperatureK: number): number {
  const C = 110.4;
  const T0 = 273.15;
  const mu0 = 1.716e-5;
  return (
    mu0 * Math.pow(temperatureK / T0, 1.5) * ((T0 + C) / (temperatureK + C))
  );
}

export const KMH_PER_MS = 3.6;

export function kmhToMs(kmh: number): number {
  return kmh / KMH_PER_MS;
}

export function msToKmh(ms: number): number {
  return ms * KMH_PER_MS;
}
