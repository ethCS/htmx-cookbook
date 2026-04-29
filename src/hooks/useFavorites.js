import { useState, useEffect } from "react";
import { db } from "../services/firebase";
import { useAuth } from "../context/AuthContext";
import {
  collection, doc, setDoc, deleteDoc,
  onSnapshot, serverTimestamp
} from "firebase/firestore";

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState([]);

  useEffect(() => {
    if (!user) { setFavorites([]); return; }
    const ref = collection(db, "users", user.uid, "favorites");
    const unsub = onSnapshot(ref, (snap) => {
      setFavorites(snap.docs.map(d => d.data()));
    });
    return unsub;
  }, [user]);

  const addFavorite = async (meal) => {
    if (!user) return;
    const ref = doc(db, "users", user.uid, "favorites", meal.idMeal);
    await setDoc(ref, {
      recipeId: meal.idMeal,
      title: meal.strMeal,
      image: meal.strMealThumb,
      category: meal.strCategory || "",
      source: "themealdb",
      addedAt: serverTimestamp(),
    });
  };

  const removeFavorite = async (recipeId) => {
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "favorites", recipeId));
  };

  const isFavorite = (recipeId) => favorites.some(f => f.recipeId === recipeId);

  return { favorites, addFavorite, removeFavorite, isFavorite };
}