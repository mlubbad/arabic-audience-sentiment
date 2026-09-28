"""The supervisor loop: what keeps it alive, and what makes it stand down."""
from server.gateway import ControlPlaneError, LeaseLost
from server.loop import serve


class Control:
    """A stand-in control plane: comparable to its name, and tick-able.

    The loop now asks every control to tick() after an idle round, so a bare
    None or string (what these tests used before) would blow up with an
    AttributeError the moment the queue went quiet. This still compares equal
    to its name so the existing identity assertions read the same.
    """

    def __init__(self, name="solo"):
        self.name = name
        self.ticks = 0

    def tick(self):
        self.ticks += 1

    def __eq__(self, other):
        return self.name == other

    def __hash__(self):
        return hash(self.name)

    def __repr__(self):
        return self.name


def test_a_job_that_raises_does_not_take_the_worker_down():
    calls = []

    def run(control, build, analyzer=None, classifier=None):
        calls.append(len(calls))
        if len(calls) == 1:
            raise ValueError("something in the collector")
        if len(calls) == 2:
            raise ControlPlaneError("batch_conflict")
        if len(calls) == 3:
            raise LeaseLost()
        return False

    # A worker that dies on one bad job stops collecting for every tenant it
    # serves, so all three failures are absorbed and the loop keeps its turn.
    # max_idle is 3 so all three failures are reached: a LeaseLost counts as
    # work done and resets the count, which is why a smaller budget would end
    # the loop before the third ever ran.
    why = serve(Control(), None, run=run, max_idle=3, sleep=lambda s: None)
    assert why == "idle"
    assert len(calls) >= 4


def test_an_empty_queue_stands_down_instead_of_spinning():
    slept = []
    why = serve(
        Control(), None,
        run=lambda *a, **k: False,
        max_idle=3,
        idle_seconds=7,
        sleep=slept.append,
    )
    assert why == "idle"
    # Two sleeps then the exit on the third idle cycle: bounded, and paced.
    assert slept == [7, 7]


def test_work_resets_the_idle_count():
    results = [True, False, True, False, False]
    calls = []

    def run(control, build, analyzer=None, classifier=None):
        calls.append(1)
        return results.pop(0) if results else False

    # Idleness is consecutive, not cumulative: a worker that finds one job an
    # hour must not exit as though the queue had been empty all along. The
    # count is what proves it — the third result resets the tally, so the loop
    # takes six turns to reach three *consecutive* empty ones. Without the
    # reset it would stand down on the fifth.
    why = serve(Control(), None, run=run, max_idle=3, sleep=lambda s: None)
    assert why == "idle"
    assert len(calls) == 6


def test_a_stop_request_ends_the_loop_between_jobs():
    seen = []

    def run(control, build, analyzer=None, classifier=None):
        seen.append(1)
        return True

    why = serve(
        Control(), None,
        run=run,
        should_stop=lambda: len(seen) >= 2,
        sleep=lambda s: None,
    )
    # Stopping happens between jobs, never inside one: killing mid-commit
    # abandons a lease that the server then has to time out.
    assert why == "stopped"
    assert len(seen) == 2


def test_every_tenant_gets_a_turn():
    seen = []

    def run(control, build, analyzer=None, classifier=None):
        seen.append(control)
        return False

    # A credential is scoped to one workspace, so a worker holding one serves
    # one tenant. Taken in turn rather than in order, or the first busy tenant
    # would starve the rest.
    slept = []
    serve([Control("a"), Control("b"), Control("c")], None, run=run, max_idle=2, sleep=slept.append)
    assert seen[:6] == ["a", "b", "c", "a", "b", "c"]
    # One pause per completed round, not one per credential: pausing between
    # tenants would make a three-tenant worker three times slower to notice
    # work than a one-tenant worker.
    assert len(slept) == 1


def test_one_quiet_tenant_does_not_stand_the_worker_down():
    calls = []

    def run(control, build, analyzer=None, classifier=None):
        calls.append(control)
        # "b" always has work; "a" never does.
        return control == "b"

    stop = {"n": 0}

    def should_stop():
        stop["n"] += 1
        return stop["n"] > 12

    serve([Control("a"), Control("b")], None, run=run, max_idle=1, should_stop=should_stop,
          sleep=lambda s: None)
    # A round is idle only when every credential came back empty. "b" keeps
    # answering, so the loop never stands down despite max_idle of one.
    assert calls.count("b") >= 5


def test_an_idle_round_ticks_every_control():
    controls = [Control("a"), Control("b")]

    # Every credential comes back empty every turn, so every round is idle and
    # every control should be asked to tick before the loop gives up.
    why = serve(controls, None, run=lambda *a, **k: False, max_idle=2, sleep=lambda s: None)
    assert why == "idle"
    assert all(c.ticks >= 1 for c in controls)


def test_a_tick_refusal_does_not_take_the_worker_down():
    class Balky(Control):
        def tick(self):
            self.ticks += 1
            raise ControlPlaneError("tenant_suspended")

    controls = [Balky("a")]
    # A refused tick is logged, not raised — the loop must still reach idle.
    why = serve(controls, None, run=lambda *a, **k: False, max_idle=2, sleep=lambda s: None)
    assert why == "idle"
    assert controls[0].ticks >= 1


def test_cli_typesafe_model_requires_api_key(monkeypatch):
    import pytest
    from server.loop import main

    monkeypatch.setattr(
        "sys.argv",
        [
            "loop",
            "--base", "http://localhost:54321",
            "--credential", "test-token",
            "--model", "typesafe",
        ],
    )
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="--model typesafe needs TYPESAFE_API_KEY"):
        main()

