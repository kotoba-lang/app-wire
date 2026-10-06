(ns wire.state
  (:require [reagent.core :as reagent]))

;; Static app descriptor (port of the `app` object in +page.svelte).
(def app-info
  {:title "Wire"
   :project "etzhayyim-project-wire"
   :name "wire-mcp-component"
   :kind "appview"
   :route-count 0
   :routes []
   :vars []
   :xrpc true
   :relative-path "60-apps/etzhayyim-project-wire/appview/wire-mcp-component/svelte/src/routes/+page.svelte"})
