namespace :billing do
  task charge: :environment do
    Billing::Charge.new(Billing::Invoice.first).call
  end
end
