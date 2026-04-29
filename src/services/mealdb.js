import cache from "./LRUCache";

const BASE = "https://www.themealdb.com/api/json/v1/1";

function cached(key, fetcher) {
  if (cache.has(key)) return cache.get(key);
  const promise = fetcher().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.put(key, promise);
  return promise;
}

export const mealdb = {
  search: (query) =>
    cached(`search:${query}`, async () => {
      const res = await fetch(`${BASE}/search.php?s=${encodeURIComponent(query)}`);
      const data = await res.json();
      return data.meals || [];
    }),

  getById: (id) =>
    cached(`meal:${id}`, async () => {
      const res = await fetch(`${BASE}/lookup.php?i=${id}`);
      const data = await res.json();
      return data.meals?.[0] || null;
    }),

  getRandom: async () => {
    const res = await fetch(`${BASE}/random.php`);
    const data = await res.json();
    return data.meals?.[0] || null;
  },

  getRandomMultiple: (count = 8) =>
    cached(`random:${count}`, async () => {
      const results = await Promise.all(
        Array.from({ length: count }, () => mealdb.getRandom())
      );
      const seen = new Set();
      const meals = results.filter(m => m && !seen.has(m.idMeal) && seen.add(m.idMeal));

      for (const meal of meals) {
        if (!cache.has(`meal:${meal.idMeal}`))
          cache.put(`meal:${meal.idMeal}`, Promise.resolve(meal));
      }

      return meals;
    }),

  invalidateRandom: () => {
    cache.delete("random:8");
  },

  getCategories: () =>
    cached("categories", async () => {
      const res = await fetch(`${BASE}/categories.php`);
      const data = await res.json();
      return data.categories || [];
    }),

  getByCategory: (category) =>
    cached(`category:${category}`, async () => {
      const res = await fetch(`${BASE}/filter.php?c=${encodeURIComponent(category)}`);
      const data = await res.json();
      return data.meals || [];
    }),

  parseIngredients: (meal) => {
    const ingredients = [];
    for (let i = 1; i <= 20; i++) {
      const ingredient = meal[`strIngredient${i}`];
      const measure = meal[`strMeasure${i}`];
      if (ingredient && ingredient.trim()) {
        ingredients.push({ ingredient: ingredient.trim(), measure: (measure || "").trim() });
      }
    }
    return ingredients;
  }
};