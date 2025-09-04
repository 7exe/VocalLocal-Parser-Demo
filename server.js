const express = require("express");
const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

const app = express();
const PORT = 3000;

const AUDIO_CLIP_CONFIG_PATH = "AudioClipConfig.xml";
const MAPPING_BASE_DIR = "mappings";

const preloaded_mappings = {};
let entry_array = [];

async function parse_xml(file_path) {
  const data = fs.readFileSync(file_path, "utf8");
  const parser = new xml2js.Parser({ explicitArray: false });
  return parser.parseStringPromise(data);
}

async function preload_xml_files() {
  const config = await parse_xml(AUDIO_CLIP_CONFIG_PATH);
  entry_array = Array.isArray(config.AudioClipConfig.Entry)
    ? config.AudioClipConfig.Entry
    : [config.AudioClipConfig.Entry];

  console.log("Preloading entries...");
  entry_array.forEach((entry) => {
    console.log(
      `Entry: primary=${entry.$.primary}, secondary=${entry.$.secondary}, mapping=${entry.$.mapping}`
    );
  });

  for (const entry of entry_array) {
    const mapping_file = entry.$.mapping;
    const mapping_path = path.join(MAPPING_BASE_DIR, mapping_file);

    const mapping_xml = await parse_xml(mapping_path);
    const mappings = Array.isArray(mapping_xml.AudioMappingTable.Entry)
      ? mapping_xml.AudioMappingTable.Entry
      : [mapping_xml.AudioMappingTable.Entry];

    preloaded_mappings[`${entry.$.primary}_${entry.$.secondary || ""}`] = {
      dir: entry.$.dir,
      mappings,
    };

    if (entry.$.primary.includes("-")) {
      preloaded_mappings[entry.$.primary] = {
        dir: entry.$.dir,
        mappings,
      };
    }
  }

  console.log("Finished preloading XML files.");
}

function parse_sequence(seq) {
  const regex =
    /^([A-Z]+)(\d+)?(?:([A-Z]+)(\d+))?(?:([A-Z]+)(\d+))?(?:([A-Z]+)(\d+))?$/;
  const match = seq.match(regex);
  if (!match) return null;

  const [, primary, num1, secondary, num2, tertiary, num3, quaternary, num4] =
    match;
  return {
    primary,
    secondary: secondary || "",
    tertiary: tertiary || "",
    quaternary: quaternary || "",
    numbers: [num1, num2, num3, num4].filter(Boolean),
  };
}

function find_dash_entry(sequence) {
  const dash_key = sequence.replace(/\d+/g, "-").trim().replace(/-$/, "");
  console.log(`Looking for dash entry: ${sequence} -> ${dash_key}`);

  const entry = preloaded_mappings[dash_key];
  if (entry) {
    console.log(`Found dash entry: ${dash_key}`);
  } else {
    console.log(`No dash entry for: ${dash_key}`);
  }
  return entry || null;
}

function get_final_audio_paths(sequences) {
  console.log("Processing sequences:", sequences);

  const results = [];

  for (const sequence of sequences) {
    console.log(`Processing sequence: ${sequence}`);

    let dash_entry = find_dash_entry(sequence);
    let dash_used = false;

    if (dash_entry) {
      dash_used = true;
      console.log(`Using dash entry for sequence: ${sequence}`);

      const primary_num = sequence.match(/\d+/)[0];
      const map_entry = dash_entry.mappings.find(
        (m) => m.$.key === primary_num
      );

      if (map_entry) {
        console.log(
          `Dash mapping found: ${primary_num} -> ${map_entry.$.value}`
        );
        results.push(path.join(dash_entry.dir, map_entry.$.value));
      } else {
        console.warn(`No dash mapping for key: ${primary_num}`);
      }
    }

    const parsed = parse_sequence(sequence);
    if (!parsed) {
      console.warn(`Failed to parse sequence: ${sequence}`);
      continue;
    }
    console.log(`Parsed sequence: ${JSON.stringify(parsed)}`);

    const base_key = `${parsed.primary}_${parsed.secondary}`;
    let entry = preloaded_mappings[base_key];

    if (!entry) {
      console.warn(`No entry for key: ${base_key}`);
      continue;
    }

    if (dash_used) parsed.numbers.shift();

    parsed.numbers.forEach((num, index) => {
      if (index === 1 && dash_used) {
        const tri_key = `${parsed.primary}_${parsed.tertiary}`;
        const entry_tri = preloaded_mappings[tri_key];
        if (entry_tri) {
          const map_entry = entry_tri.mappings.find((m) => m.$.key === num);
          if (map_entry) {
            results.push(
              path.join(
                entry_tri.dir.replace("domestic\\", ""),
                map_entry.$.value
              )
            );
          }
        }
      } else if (index === 2 && dash_used) {
        const qua_key = `${parsed.primary}_${parsed.quaternary}`;
        const entry_qua = preloaded_mappings[qua_key];
        if (entry_qua) {
          const map_entry = entry_qua.mappings.find((m) => m.$.key === num);
          if (map_entry) {
            results.push(
              path.join(
                entry_qua.dir.replace("domestic\\", ""),
                map_entry.$.value
              )
            );
          }
        }
      } else {
        const map_entry = entry.mappings.find((m) => m.$.key === num);
        if (map_entry) {
          console.log(`Mapping found: ${num} -> ${map_entry.$.value}`);
          results.push(
            path.join(entry.dir.replace("domestic\\", ""), map_entry.$.value)
          );
        } else {
          console.warn(`No mapping for number: ${num} in ${entry.dir}`);
        }
      }
    });
  }

  console.log("Final audio paths:", results);
  return results;
}

app.use(express.json());
app.use(express.static("public"));
app.use("/domestic/vocalLocal", express.static("vocalLocal"));

app.post("/audio-sequence", (req, res) => {
  const { sequence } = req.body;

  console.log(`Received sequence input: ${sequence}`);
  const sequences = sequence.split(":");
  const final_results = get_final_audio_paths(sequences);
  res.json(final_results);
});

preload_xml_files().then(() => {
  app.listen(PORT, () => {
    console.log(`Running on http://localhost:${PORT}`);
  });
});
