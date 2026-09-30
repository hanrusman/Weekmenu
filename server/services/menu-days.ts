/**
 * Menu days with the version of their library recipe's own picture, so the
 * week view can show it. Append WHERE/JOIN/ORDER BY using the md alias.
 */
export const MENU_DAY_SQL = `
  SELECT md.*, r.image_version AS recipe_image_version
  FROM menu_days md
  LEFT JOIN recipes r ON r.id = md.recipe_id`;
