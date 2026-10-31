-- Instagram Reel transcription: every saved ad now carries the reel it was written from (reel_url, reel_transcript)
-- and Claude's analysis of it (reel_analysis). They live inside campaigns.ad_copies_json, so existing campaigns get empty values.

UPDATE campaigns SET ad_copies_json = (
  SELECT json_group_array(json(j)) FROM (
    SELECT json_set(value, '$.reel_url', COALESCE(json_extract(value, '$.reel_url'), ''), '$.reel_transcript', COALESCE(json_extract(value, '$.reel_transcript'), '')) AS j
    FROM json_each(campaigns.ad_copies_json) ORDER BY key)
) WHERE ad_copies_json IS NOT NULL AND ad_copies_json NOT IN ('', '[]') AND json_valid(ad_copies_json);
