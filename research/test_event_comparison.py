"""Somente lógica de avaliação; estes testes não validam marcha real."""
import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace

import event_comparison as b
import event_comparison as vg


def event(t,side='left'):
    return dict(timeMs=t,side=side)


class MatchingTests(unittest.TestCase):
    def test_unhandled_uncertainty_intervals_stop_scoring(self):
        with self.assertRaises(ValueError):
            b.compare(dict(events=[],intervals=[{'startMs':0,'endMs':100}]),[],1000)

    def test_anatomical_sides_restore_only_documented_flip(self):
        original=[event(300,'left')]
        self.assertEqual(b.anatomical_candidates(original,True),[event(300,'right')])
        self.assertEqual(b.anatomical_candidates(original,False),original)
        self.assertEqual(original,[event(300,'left')])

    def test_hip_adapter_preserves_offset_and_three_item_contract(self):
        detector=SimpleNamespace(skeleton='synthetic',confidence_threshold=.4)
        def loader(path,skeleton,keys,confidence):
            self.assertEqual(keys,['LEFT_HIP','RIGHT_HIP'])
            return {'LEFT_HIP':[(2,4,.8)],'RIGHT_HIP':[(4,6,.6)]},[0],9
        vg.install_hip_adapter(detector,loader)
        self.assertEqual(detector._get_hip_reference_data('synthetic'), ([(3,5,.6)],True,9))

    def test_hip_adapter_empty_has_no_fallback_data(self):
        detector=SimpleNamespace(skeleton='synthetic',confidence_threshold=.4)
        vg.install_hip_adapter(detector,lambda *args:({},[],12))
        self.assertEqual(detector._get_hip_reference_data('synthetic'),(None,True,12))

    def test_virtual_hip_valid_and_missing(self):
        self.assertEqual(vg.virtual_hip([(None,None,None), (1,2,None)], [(1,2,.8)]*2), [None,None])
        self.assertEqual(vg.virtual_hip([(10,20,.9),None],[(30,40,.8),(1,2,.8)]),[(20,30,.8),None])
        with self.assertRaises(ValueError):
            vg.virtual_hip([],[(1,2,.8)])

    def test_maximum_cardinality_before_error(self):
        matches,extra,missed=b.match_events([event(100),event(200)],[event(10),event(110)])
        self.assertEqual((len(matches),len(extra),len(missed)),(2,0,0))

    def test_duplicate_predictions_are_not_two_tp(self):
        matches,extra,_=b.match_events([event(100)],[event(99),event(100)])
        self.assertEqual((len(matches),len(extra),matches[0]['errorMs']),(1,1,0))

    def test_sides_audited_not_silently_swapped(self):
        h,p=[event(100)],[event(100,'right')]
        self.assertFalse(b.match_events(h,p)[0][0]['sideCorrect'])
        self.assertEqual(len(b.match_events(h,p,require_side=True)[0]),0)

    def test_exact_tolerance(self):
        self.assertEqual(len(b.match_events([event(100)],[event(200)])[0]),1)
        self.assertEqual(len(b.match_events([event(100)],[event(200.01)])[0]),0)

    def test_nan_is_rejected(self):
        with self.assertRaises(ValueError):
            b.match_events([event(float('nan'))],[])

    def test_empty_is_not_perfect_accuracy(self):
        ref=dict(events=[],walkingStartMs=0,walkingEndMs=1000)
        r=b.compare(ref,[],1000)
        self.assertIsNone(r['precision'])
        self.assertIsNone(r['f1'])
        self.assertIsNone(r['candidateCadenceSpm'])

    def test_window_ambiguity_and_interval_cadence(self):
        ref=dict(walkingStartMs=100,walkingEndMs=900,events=[
            dict(event(200),kind='initial_contact',confidence='high'),
            dict(event(700,'right'),kind='initial_contact',confidence='high'),
            dict(event(850),kind='indeterminate',confidence='low')])
        r=b.compare(ref,[event(50),event(200),event(700,'right'),event(860)],1000)
        self.assertEqual((r['tp'],r['fp'],r['fn']),(2,0,0))
        self.assertEqual(len(r['outsideWindow']),1)
        self.assertEqual(len(r['excludedAmbiguous']),1)
        self.assertEqual(r['humanCadenceSpm'],120)

    def test_unmatched_known_contact_remains_fn(self):
        ref=dict(events=[dict(event(200),kind='initial_contact',confidence='high')])
        r=b.compare(ref,[],1000)
        self.assertEqual(r['fn'],1)
        self.assertEqual(r['f1'],0)

    def test_reverse_window_rejected(self):
        with self.assertRaises(ValueError):
            b.compare(dict(events=[],walkingStartMs=900,walkingEndMs=100),[],1000)


if __name__=='__main__':
    unittest.main()
