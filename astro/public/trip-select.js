// Rebuilds a trip <select>'s options to a "No trip" choice (always available, regardless
// of buyer — a purchase doesn't have to belong to a trip or budget) followed by the trips
// where `buyer` has a budget line (same rule Studio applies when offering trips on a
// familyPurchase). Options are fully replaced with createElement/replaceChildren rather
// than toggled with .hidden, because iOS Safari ignores <option>.hidden (the option stays
// visible regardless of the flag). Shared by add-price.astro and edit-price.astro.
//
// tripSel: the <select> element.
// trips: [{ _id, label, people }] — people is the list of names with a budget line.
// buyer: the currently selected buyer's name.
// noTripNoteEl: element to show/hide with a "no budget on any trip" message, or null.
// desiredValue: optional — the trip id to select if still valid (defaults to the
//   select's current value, i.e. "keep what's selected if it's still valid"). "" selects
//   "No trip", which is always valid.
window.applyBuyerTripFilter = function (tripSel, trips, buyer, noTripNoteEl, desiredValue) {
  const keep = desiredValue !== undefined ? desiredValue : tripSel.value
  const list = Array.isArray(trips) ? trips : []
  const validTrips = list.filter((t) => Array.isArray(t.people) && t.people.includes(buyer))

  const noTripOption = document.createElement('option')
  noTripOption.value = ''
  noTripOption.textContent = 'No trip'

  const options = [noTripOption]
  validTrips.forEach((t) => {
    const opt = document.createElement('option')
    opt.value = t._id
    opt.textContent = t.label || 'Trip'
    options.push(opt)
  })
  tripSel.replaceChildren(...options)
  tripSel.value = validTrips.some((t) => t._id === keep) ? keep : ''

  if (noTripNoteEl) {
    if (validTrips.length > 0) {
      noTripNoteEl.hidden = true
      noTripNoteEl.textContent = ''
    } else {
      noTripNoteEl.textContent = buyer + ' has no budget on any trip. You can still use No trip, or add a budget in Trip Settings.'
      noTripNoteEl.hidden = false
    }
  }
}
