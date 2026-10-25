-- Schedule moves from the campaign to each ad set; the ad format moves from the campaign to each ad.
-- Both live inside JSON columns (ad_sets_json / ad_copies_json), so existing campaigns are rewritten in place.
-- campaigns.start_date / start_time stay as a summary of the earliest ad set (no column drops in D1).

UPDATE campaigns SET ad_sets_json = (
  SELECT json_group_array(json(j)) FROM (
    SELECT json_set(value, '$.start_date', campaigns.start_date, '$.start_time', COALESCE(campaigns.start_time, '09:00')) AS j
    FROM json_each(campaigns.ad_sets_json) ORDER BY key)
) WHERE ad_sets_json IS NOT NULL AND ad_sets_json NOT IN ('', '[]') AND json_valid(ad_sets_json);

UPDATE campaigns SET ad_copies_json = (
  SELECT json_group_array(json(j)) FROM (
    SELECT json_set(value, '$.format', CASE campaigns.ad_format WHEN 'VIDEO' THEN 'VIDEO' WHEN 'REELS' THEN 'VIDEO' WHEN 'CAROUSEL' THEN 'CAROUSEL' ELSE 'SINGLE_IMAGE' END) AS j
    FROM json_each(campaigns.ad_copies_json) ORDER BY key)
) WHERE ad_copies_json IS NOT NULL AND ad_copies_json NOT IN ('', '[]') AND json_valid(ad_copies_json);
