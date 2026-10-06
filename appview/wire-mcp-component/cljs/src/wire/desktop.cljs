(ns wire.desktop
  (:require [wire.ui :as ui]
            [reagent.dom :as rdom]))

(defn ^:export init! []
  (rdom/render [ui/root-view] (js/document.getElementById "app")))
