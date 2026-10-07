(ns wire.ui
  (:require [wire.state :as state]
            [reagent.core :as reagent]))

;; Port of +page.svelte (SvelteKit placeholder screen).
;; Structural chrome is hand-rolled hiccup (appkit.core is still .cljk on
;; main and invisible to shadow-cljs — same contract as yotei.ui/slides.ui).

(defn- fact [label value]
  [:div {:class "fact"}
   [:span {:class "fact-label"} label]
   [:strong value]])

(defn- panel [title & body]
  [:section {:class "panel"}
   [:h2 title]
   body])

(defn- muted [text]
  [:p {:class "muted"} text])

(defn root-view []
  (let [app state/app-info]
    ^{:key "root"}
    [:main
     [:section {:class "top"}
      [:p (str "Cloudflare " (:kind app))]
      [:h1 (:title app)]
      [:span (:name app)]]

     [:section {:class "facts"}
      (fact "Project" (:project app))
      (fact "Routes" (str (:route-count app)))
      (fact "XRPC" (if (:xrpc app) "enabled" "not configured"))]

     (panel "Public Routes"
            (if (seq (:routes app))
              [:ul (map (fn [route] ^{:key route} [:li route]) (:routes app))]
              (muted "No public route is declared next to this app surface.")))

     (panel "Runtime Bindings"
            (if (seq (:vars app))
              [:ul {:class "chips"}
               (map (fn [k] ^{:key k} [:li k]) (:vars app))]
              (muted "No public vars are declared in the nearest wrangler config.")))

     (panel "Source" [:p {:class "path-p"} (:relative-path app)])]))
