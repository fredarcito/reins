module Admin
  class ReportsController < ::ApplicationController
    def show
      respond_to do |format|
        format.html { render inertia: { total: Billing::Invoice::STATUSES.size } }
      end
    end
  end
end
