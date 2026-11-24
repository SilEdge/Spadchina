package backend

import (
	_ "embed"
	"encoding/json"
)

//go:embed atlas-reading.json
var atlasReadingJSON []byte

type atlasReadingEntry struct {
	extended string
	seed     string
	lead     string
}

var atlasReading = loadAtlasReading()

func loadAtlasReading() map[string]atlasReadingEntry {
	var supplemental map[string][]map[string]string
	if err := json.Unmarshal(atlasReadingJSON, &supplemental); err != nil {
		panic(err)
	}
	var original map[string]struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(atlasContentJSON, &original); err != nil {
		panic(err)
	}
	entries := make(map[string]atlasReadingEntry, len(supplemental))
	for _, place := range readAtlasData().Places {
		addition, ok := supplemental[place.ID]
		if !ok {
			continue
		}
		seed := publicArticleContent(string(original[place.ID].Content))
		var blocks []map[string]string
		if err := json.Unmarshal([]byte(seed), &blocks); err != nil || len(blocks) == 0 {
			panic("invalid atlas reading seed: " + place.ID)
		}
		expanded, err := json.Marshal(append(blocks, addition...))
		if err != nil {
			panic(err)
		}
		lead, err := json.Marshal([]map[string]string{{"type": "lead", "text": place.Lead}})
		if err != nil {
			panic(err)
		}
		entries[place.ID] = atlasReadingEntry{extended: string(expanded), seed: seed, lead: string(lead)}
	}
	return entries
}

// Expand the published seed on read so existing databases and administrator edits can coexist.
func publicAtlasArticleContent(slug, raw string) string {
	visible := publicArticleContent(raw)
	entry, ok := atlasReading[slug]
	if ok && (visible == entry.seed || visible == entry.lead || (slug == "brest" && isOriginalBrestSeed(visible))) {
		return entry.extended
	}
	return visible
}
