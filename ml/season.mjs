// Prints the season calendar (the site's own season.js) as JSON for the ML runner.
import { fallbackSeason } from '../season.js'
process.stdout.write(JSON.stringify(fallbackSeason()))
