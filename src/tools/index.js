import { registerEiendomTools } from "./eiendom.js";
import { registerHolidayTools } from "./holiday.js";
import { registerKlarnaTools } from "./klarna.js";
import { registerMobilityTools } from "./mobility.js";
import { registerTorgetTools } from "./torget.js";

export function registerTools(target) {
  registerTorgetTools(target);
  registerMobilityTools(target);
  registerHolidayTools(target);
  registerEiendomTools(target);
  registerKlarnaTools(target);
}
