class Billing::LineItem < ApplicationRecord
  belongs_to :invoice
end
